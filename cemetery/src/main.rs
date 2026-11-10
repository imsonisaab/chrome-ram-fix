// cemeteryd — daemon side of the Level-3 store.
//
//   cemeteryd put    <key32> <file-with-payload>
//   cemeteryd get    <key32>
//   cemeteryd warm   <n>
//   cemeteryd keys
//   cemeteryd touch  <key32>
//   cemeteryd size
//
// JSON-lines protocol over stdio for the JS/Embalmer bridge, so we can talk to
// it from the extension host process without new deps on either side.

use std::io::{BufRead, Write};
use std::path::Path;

fn main() {
    let dir = std::env::var("CEMETERY_DIR").unwrap_or_else(|_| "cemetery/data".to_string());
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(|s| s.as_str()) {
        Some("put") => {
            let key = parse_key(&args[1]);
            let path = &args[2];
            let payload = std::fs::read(Path::new(path)).expect("payload read");
            let c = cemetery::Cemetery::open(&dir).expect("open");
            c.put(key, &payload).expect("put");
            eprintln!("ok");
        }
        Some("get") => {
            let key = parse_key(&args[1]);
            let c = cemetery::Cemetery::open(&dir).expect("open");
            match c.get(key) {
                Ok(v) => {
                    std::io::stdout().write_all(&v).expect("write");
                }
                Err(e) => {
                    eprintln!("error: {}", e);
                    std::process::exit(1);
                }
            }
        }
        Some("warm") => {
            let n: usize = args[1].parse().unwrap_or(3);
            let c = cemetery::Cemetery::open(&dir).expect("open");
            println!("{}", c.warm_next(n).iter().map(|k| k.to_string()).collect::<Vec<_>>().join(" "));
        }
        Some("keys") => {
            let c = cemetery::Cemetery::open(&dir).expect("open");
            println!("{}", c.keys().iter().map(|k| k.to_string()).collect::<Vec<_>>().join(" "));
        }
        Some("touch") => {
            let key = parse_key(&args[1]);
            let c = cemetery::Cemetery::open(&dir).expect("open");
            c.touch(key).expect("touch");
            eprintln!("ok");
        }
        Some("size") => {
            let p = Path::new(&dir).join("store.cmt");
            let n = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            println!("{}", n);
        }
        Some("serve") => {
            // JSON-lines stdin server for the Embalmer bridge.
            let c = cemetery::Cemetery::open(&dir).expect("open");
            let stdin = std::io::stdin();
            let mut out = std::io::stdout();
            for line in stdin.lock().lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => break,
                };
                let resp = handle_line(&c, line.trim());
                if resp.is_empty() {
                    continue;
                }
                let _ = out.write_all(resp.as_bytes());
                let _ = out.write_all(b"\n");
                let _ = out.flush();
            }
        }
        _ => {
            eprintln!("usage: cemeteryd put|get|warm|keys|touch|size|serve");
            std::process::exit(2);
        }
    }
}

fn handle_line(c: &cemetery::Cemetery, line: &str) -> String {
    // minimal JSON parsing without serde: we only need {"cmd":"..","key":N,"payload":".."}
    let cmd = json_str(line, "cmd").unwrap_or_default();
    match cmd.as_str() {
        "put" => {
            let key = json_u32(line, "key").unwrap_or(0);
            let data = match json_b64_or_raw(line, "payload") {
                Some(d) => d,
                None => return err("missing payload"),
            };
            match c.put(key, &data) {
                Ok(()) => ok("ok"),
                Err(e) => err(&e.to_string()),
            }
        }
        "get" => {
            let key = json_u32(line, "key").unwrap_or(0);
            match c.get(key) {
                Ok(v) => {
                    let mut s = String::from("{\"ok\":true,\"len\":");
                    s.push_str(&v.len().to_string());
                    s.push_str(",\"payload\":\"");
                    s.push_str(&b64(&v));
                    s.push_str("\"}");
                    s
                }
                Err(e) => err(&e.to_string()),
            }
        }
        "warm" => {
            let n = json_u32(line, "n").unwrap_or(3) as usize;
            let keys: Vec<String> = c.warm_next(n).iter().map(|k| k.to_string()).collect();
            format!("{{\"ok\":true,\"keys\":[{}]}}", keys.join(","))
        }
        "keys" => {
            let keys: Vec<String> = c.keys().iter().map(|k| k.to_string()).collect();
            format!("{{\"ok\":true,\"keys\":[{}]}}", keys.join(","))
        }
        "size" => {
            let n = std::fs::metadata(&c.store_path()).map(|m| m.len()).unwrap_or(0);
            format!("{{\"ok\":true,\"bytes\":{}}}", n)
        }
        "touch" => {
            let key = json_u32(line, "key").unwrap_or(0);
            match c.touch(key) {
                Ok(()) => ok("ok"),
                Err(e) => err(&e.to_string()),
            }
        }
        _ => err("unknown cmd"),
    }
}

fn parse_key(s: &str) -> u32 {
    s.parse::<u32>().unwrap_or_else(|_| cemetery::key_for(s))
}

fn ok(s: &str) -> String {
    format!("{{\"ok\":true,\"msg\":\"{}\"}}", s)
}

fn err(s: &str) -> String {
    let s = s.replace('\\', "\\\\").replace('"', "\\\"");
    format!("{{\"ok\":false,\"error\":\"{}\"}}", s)
}

// ---- tiny JSON helpers (no serde) ----------------------------------------
fn json_str(line: &str, field: &str) -> Option<String> {
    // tolerant: accept both "cmd":"x" and "cmd": "x" (json.dumps inserts a space)
    let mut pat = format!("\"{}\": \"", field);
    let mut i = match line.find(&pat) {
        Some(p) => p + pat.len(),
        None => {
            pat = format!("\"{}\":\"", field);
            line.find(&pat)? + pat.len()
        }
    };
    let rest = &line[i..];
    let mut out = String::new();
    let mut chars = rest.chars();
    while let Some(ch) = chars.next() {
        match ch {
            '"' => return Some(out),
            '\\' => {
                if let Some(n) = chars.next() {
                    out.push(n);
                }
            }
            _ => out.push(ch),
        }
    }
    Some(out)
}

fn json_u32(line: &str, field: &str) -> Option<u32> {
    let pat = format!("\"{}\": ", field);
    let i = match line.find(&pat) {
        Some(p) => p + pat.len(),
        None => {
            let p2 = format!("\"{}\":", field);
            line.find(&p2)? + p2.len()
        }
    };
    let rest = line[i..].trim_start();
    let mut num = String::new();
    for ch in rest.chars() {
        if ch.is_ascii_digit() {
            num.push(ch);
        } else if !num.is_empty() {
            break;
        }
    }
    num.parse().ok()
}

/// Accept base64 (standard alphabet) or raw escaped string.
fn json_b64_or_raw(line: &str, field: &str) -> Option<Vec<u8>> {
    let s = json_str(line, field)?;
    b64decode(&s)
}

// standard base64 alphabet, tolerant of missing padding at wrap time
const B64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn b64(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            out.push(B64[(n >> 6) as usize & 63] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(B64[n as usize & 63] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn b64decode(s: &str) -> Option<Vec<u8>> {
    let mut acc: u32 = 0;
    let mut bits = 0;
    let mut out = Vec::new();
    for ch in s.bytes() {
        if ch == b'=' || ch == b'\n' || ch == b'\r' {
            continue;
        }
        let v = B64.iter().position(|&c| c == ch)? as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((acc >> bits) & 0xff) as u8);
        }
    }
    Some(out)
}
