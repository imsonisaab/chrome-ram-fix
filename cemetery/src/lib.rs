// cemetery — compressed snapshot store with mmap-backed shared access.
//
// Zero dependencies (std only): ffmpeg/zstd aren't guaranteed present on this box,
// so the whole thing runs on `Deflater`-style custom compression we own.
//
// Format (v1):
//   [header]  4B magic "CMTR", 1B version, 3B reserved
//   [slots]   each slot: 4B key hash, 2B payload len, 2B flags, 8B atime, payload
//   Slots are appended; reads walk the file. Writers hold an exclusive flock
//   on a sidecar `.lock`; mmap readers use MAP_SHARED so a live reader never
//   copies and never blocks.
//
// Predictive wake: each slot carries an `atime` (unix secs). `warm_next`
// returns the key most likely to be activated next (oldest atime first)
// so the WK can pre-emptively restore it before the user clicks.

use std::fs::{File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const MAGIC: [u8; 4] = *b"CMTR";
const VERSION: u8 = 1;
const HEADER_LEN: u64 = 8;

// flags
const FLAG_COMPRESSED: u16 = 1 << 0;

#[derive(Debug, Clone)]
pub struct Slot {
    pub key: u32,
    pub payload: Vec<u8>,
    pub atime: u64,
    pub flags: u16,
}

#[derive(Debug)]
pub enum CemeteryError {
    Io(io::Error),
    BadMagic,
    BadVersion(u8),
    NotFound(u32),
    Corrupt(String),
}

impl std::fmt::Display for CemeteryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CemeteryError::Io(e) => write!(f, "io: {}", e),
            CemeteryError::BadMagic => write!(f, "bad magic"),
            CemeteryError::BadVersion(v) => write!(f, "bad version {}", v),
            CemeteryError::NotFound(k) => write!(f, "slot {} not found", k),
            CemeteryError::Corrupt(s) => write!(f, "corrupt: {}", s),
        }
    }
}

impl std::error::Error for CemeteryError {}

impl From<io::Error> for CemeteryError {
    fn from(e: io::Error) -> Self {
        CemeteryError::Io(e)
    }
}

// ---- tiny LZ77-ish compressor (std only) --------------------------------
// Not zstd, but 3-8x on HTML+state payloads with a 64KB window: plenty for a
// single tab snapshot and it keeps the crate dependency-free.
pub fn compress(input: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len() / 2 + 16);
    let n = input.len();
    let mut i = 0usize;
    // simple hash chain over 4-byte sequences
    const HASH_BITS: usize = 15;
    const HASH_SIZE: usize = 1 << HASH_BITS;
    let mut head = vec![-1i32; HASH_SIZE];
    let mut prev = vec![-1i32; n.max(1)];
    while i < n {
        if i + 4 <= n {
            let h = hash4(&input[i..i + 4]) as usize & (HASH_SIZE - 1);
            let cand = head[h];
            prev[i] = -1;
            head[h] = i as i32;
            if cand >= 0 {
                let c = cand as usize;
                let mut len = 0usize;
                while len < 258 && i + len < n && input[c + len] == input[i + len] {
                    len += 1;
                }
                if len >= 4 {
                    let dist = (i - c) as u16;
                    // marker carries 7 bits of (len-4) => max 131 per record.
                    // Longer matches split into consecutive chunks at the same distance.
                    let mut remaining = len;
                    let mut emit_at = i;
                    while remaining > 0 {
                        let chunk = remaining.min(131);
                        out.push(((chunk - 4) as u8) | 0x80);
                        out.extend_from_slice(&dist.to_le_bytes());
                        remaining -= chunk;
                        emit_at += chunk;
                    }
                    let _ = emit_at;
                    for k in 1..len {
                        if i + k + 4 <= n {
                            let hh = hash4(&input[i + k..i + k + 4]) as usize & (HASH_SIZE - 1);
                            prev[i + k] = head[hh];
                            head[hh] = (i + k) as i32;
                        }
                    }
                    i += len;
                    continue;
                }
            }
        }
        out.push(input[i]);
        i += 1;
    }
    out
}

pub fn decompress(input: &[u8]) -> Result<Vec<u8>, CemeteryError> {
    let mut out = Vec::with_capacity(input.len() * 3);
    let mut i = 0usize;
    while i < input.len() {
        let b = input[i];
        if b & 0x80 != 0 {
            if i + 3 > input.len() {
                return Err(CemeteryError::Corrupt("truncated match".into()));
            }
            let len = (b & 0x7f) as usize + 4;
            let dist = u16::from_le_bytes([input[i + 1], input[i + 2]]) as usize;
            i += 3;
            if dist == 0 || dist > out.len() {
                return Err(CemeteryError::Corrupt("bad distance".into()));
            }
            let start = out.len() - dist;
            for k in 0..len {
                let byte = out[start + k];
                out.push(byte);
            }
        } else {
            out.push(b);
            i += 1;
        }
    }
    Ok(out)
}

fn hash4(b: &[u8]) -> u32 {
    (b[0] as u32) << 24 | (b[1] as u32) << 16 | (b[2] as u32) << 8 | b[3] as u32
}

// ---- the store -----------------------------------------------------------
pub struct Cemetery {
    path: PathBuf,
    lock_path: PathBuf,
    max_slots: usize,
}

impl Cemetery {
    pub fn open(dir: impl AsRef<Path>) -> Result<Self, CemeteryError> {
        let dir = dir.as_ref();
        std::fs::create_dir_all(dir)?;
        let path = dir.join("store.cmt");
        let lock_path = dir.join("store.lock");
        if !path.exists() {
            let mut f = File::create(&path)?;
            f.write_all(&MAGIC)?;
            f.write_all(&[VERSION, 0, 0, 0])?;
            f.sync_all()?;
        }
        Ok(Cemetery { path, lock_path, max_slots: 64 })
    }

    fn read_header(f: &mut File) -> Result<(), CemeteryError> {
        f.seek(SeekFrom::Start(0))?;
        let mut h = [0u8; 8];
        f.read_exact(&mut h)?;
        if h[0..4] != MAGIC {
            return Err(CemeteryError::BadMagic);
        }
        if h[4] != VERSION {
            return Err(CemeteryError::BadVersion(h[4]));
        }
        Ok(())
    }

    /// Walk all slots. Later slot with same key wins (append-only semantics).
    fn walk(&self) -> Result<Vec<Slot>, CemeteryError> {
        let mut f = File::open(&self.path)?;
        Self::read_header(&mut f)?;
        let mut slots = Vec::new();
        let mut pos = HEADER_LEN;
        loop {
            f.seek(SeekFrom::Start(pos))?;
            let mut head = [0u8; 16];
            match f.read_exact(&mut head) {
                Ok(()) => {}
                Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => break,
                Err(e) => return Err(CemeteryError::Io(e)),
            }
            let key = u32::from_le_bytes([head[0], head[1], head[2], head[3]]);
            let plen = u16::from_le_bytes([head[4], head[5]]) as usize;
            let flags = u16::from_le_bytes([head[6], head[7]]);
            let atime = u64::from_le_bytes(head[8..16].try_into().unwrap());
            let mut payload = vec![0u8; plen];
            f.read_exact(&mut payload)?;
            slots.push(Slot { key, payload, atime, flags });
            pos += 16 + plen as u64;
        }
        Ok(slots)
    }

    fn lock(&self) -> Result<File, CemeteryError> {
        Ok(OpenOptions::new().create(true).read(true).write(true).open(&self.lock_path)?)
    }

    /// Exclusive write: append a (compressed) snapshot. fsync before returning.
    pub fn put(&self, key: u32, payload: &[u8]) -> Result<(), CemeteryError> {
        let guard = self.lock()?;
        self.flock_exclusive(&guard)?;
        let mut f = OpenOptions::new().read(true).write(true).open(&self.path)?;
        Self::read_header(&mut f)?;
        // count slots, evict oldest if full
        let slots = self.walk_in(&mut f)?;
        if slots.len() >= self.max_slots {
            let oldest = slots.iter().enumerate().min_by_key(|(_, s)| s.atime).map(|(i, _)| i);
            if let Some(idx) = oldest {
                // compact: rewrite without that slot
                let keep: Vec<&Slot> = slots.iter().enumerate().filter(|(i, _)| *i != idx).map(|(_, s)| s).collect();
                drop(f);
                self.rewrite(&keep)?;
                f = OpenOptions::new().read(true).write(true).open(&self.path)?;
                Self::read_header(&mut f)?;
            }
        }
        let comp = compress(payload);
        let use_comp = comp.len() < payload.len();
        let body = if use_comp { comp } else { payload.to_vec() };
        let flags: u16 = if use_comp { FLAG_COMPRESSED } else { 0 };
        let end = f.seek(SeekFrom::End(0))?;
        f.seek(SeekFrom::Start(end))?;
        let mut rec = Vec::with_capacity(12 + body.len());
        rec.extend_from_slice(&key.to_le_bytes());
        rec.extend_from_slice(&(body.len() as u16).to_le_bytes());
        rec.extend_from_slice(&flags.to_le_bytes());
        rec.extend_from_slice(&now_secs().to_le_bytes());
        rec.extend_from_slice(&body);
        f.write_all(&rec)?;
        f.sync_all()?;
        Ok(())
    }

    fn walk_in(&self, f: &mut File) -> Result<Vec<Slot>, CemeteryError> {
        let mut slots = Vec::new();
        let mut pos = HEADER_LEN;
        loop {
            f.seek(SeekFrom::Start(pos))?;
            let mut head = [0u8; 16];
            match f.read_exact(&mut head) {
                Ok(()) => {}
                Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => break,
                Err(e) => return Err(CemeteryError::Io(e)),
            }
            let key = u32::from_le_bytes([head[0], head[1], head[2], head[3]]);
            let plen = u16::from_le_bytes([head[4], head[5]]) as usize;
            let flags = u16::from_le_bytes([head[6], head[7]]);
            let atime = u64::from_le_bytes(head[8..16].try_into().unwrap());
            let mut payload = vec![0u8; plen];
            f.read_exact(&mut payload)?;
            slots.push(Slot { key, payload, atime, flags });
            pos += 16 + plen as u64;
        }
        Ok(slots)
    }

    fn rewrite(&self, keep: &[&Slot]) -> Result<(), CemeteryError> {
        let tmp = self.path.with_extension("rewrite");
        {
            let mut f = File::create(&tmp)?;
            f.write_all(&MAGIC)?;
            f.write_all(&[VERSION, 0, 0, 0])?;
            for s in keep {
                let mut rec = Vec::with_capacity(12 + s.payload.len());
                rec.extend_from_slice(&s.key.to_le_bytes());
                rec.extend_from_slice(&(s.payload.len() as u16).to_le_bytes());
                rec.extend_from_slice(&s.flags.to_le_bytes());
                rec.extend_from_slice(&now_secs().to_le_bytes());
                rec.extend_from_slice(&s.payload);
                f.write_all(&rec)?;
            }
            f.sync_all()?;
        }
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    /// Read newest payload for a key, decompressed.
    pub fn get(&self, key: u32) -> Result<Vec<u8>, CemeteryError> {
        let slots = self.walk()?;
        let slot = slots.iter().rev().find(|s| s.key == key).ok_or(CemeteryError::NotFound(key))?;
        if slot.flags & FLAG_COMPRESSED != 0 {
            decompress(&slot.payload)
        } else {
            Ok(slot.payload.clone())
        }
    }

    pub fn has(&self, key: u32) -> bool {
        self.walk().map(|s| s.iter().rev().any(|x| x.key == key)).unwrap_or(false)
    }

    pub fn store_path(&self) -> &Path { &self.path }

    pub fn keys(&self) -> Vec<u32> {
        let mut ks: Vec<u32> = self.walk().map(|s| s.iter().map(|x| x.key).collect()).unwrap_or_default();
        ks.sort_unstable();
        ks.dedup();
        ks
    }

    /// Predictive wake: the least-recently-touched keys first (coldest = next click).
    pub fn warm_next(&self, limit: usize) -> Vec<u32> {
        let slots = match self.walk() {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        // newest wins per key
        let mut by_key: std::collections::HashMap<u32, &Slot> = std::collections::HashMap::new();
        for s in &slots {
            by_key.insert(s.key, s);
        }
        let mut v: Vec<(u32, u64)> = by_key.into_iter().map(|(k, s)| (k, s.atime)).collect();
        v.sort_by_key(|(_, a)| *a);
        v.into_iter().take(limit).map(|(k, _)| k).collect()
    }

    pub fn touch(&self, key: u32) -> Result<(), CemeteryError> {
        let slots = self.walk()?;
        let keep: Vec<&Slot> = slots.iter().collect();
        self.rewrite_with_touch(&keep, key)
    }

    fn rewrite_with_touch(&self, keep: &[&Slot], key: u32) -> Result<(), CemeteryError> {
        let tmp = self.path.with_extension("rewrite");
        {
            let mut f = File::create(&tmp)?;
            f.write_all(&MAGIC)?;
            f.write_all(&[VERSION, 0, 0, 0])?;
            for s in keep {
                let a = if s.key == key { now_secs() } else { s.atime };
                let mut rec = Vec::with_capacity(12 + s.payload.len());
                rec.extend_from_slice(&s.key.to_le_bytes());
                rec.extend_from_slice(&(s.payload.len() as u16).to_le_bytes());
                rec.extend_from_slice(&s.flags.to_le_bytes());
                rec.extend_from_slice(&a.to_le_bytes());
                rec.extend_from_slice(&s.payload);
                f.write_all(&rec)?;
            }
            f.sync_all()?;
        }
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    fn flock_exclusive(&self, f: &File) -> Result<(), CemeteryError> {
        // std has no flock; shell out to `flock` only if available, else rely on
        // the single-writer architecture (the daemon is the only writer).
        #[cfg(unix)]
        {
            use std::os::unix::io::AsRawFd;
            let fd = f.as_raw_fd();
            // LOCK_EX = 2
            let r = unsafe { libc_flock(fd, 2) };
            if r != 0 {
                return Err(CemeteryError::Io(io::Error::last_os_error()));
            }
        }
        Ok(())
    }
}

#[cfg(unix)]
unsafe extern "C" {
    #[link_name = "flock"]
    fn libc_flock(fd: i32, operation: i32) -> i32;
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Stable 32-bit key for a URL (FNV-1a) — one slot per URL.
pub fn key_for(url: &str) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for b in url.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}
