use cemetery::{compress, decompress, Cemetery, key_for};

fn roundtrip(data: &[u8]) {
    let c = compress(data);
    let d = decompress(&c).expect("decompress");
    assert_eq!(d, data, "roundtrip mismatch (in {} out {})", data.len(), c.len());
}

#[test]
fn roundtrip_various() {
    roundtrip(b"");
    roundtrip(b"a");
    roundtrip(b"hello hello hello hello hello");
    roundtrip(b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    // the real killer: >131-byte repeated runs (marker is 7 bits + 4 = 131 max)
    let big = "abcdefgh".repeat(200); // 1600 bytes, matches of length >131
    roundtrip(big.as_bytes());
    let html = "<html><body><h1>Inbox</h1></body></html>".repeat(40);
    roundtrip(html.as_bytes());
}

#[test]
fn compression_actually_compresses() {
    let html = "<html><body><h1>Inbox</h1></body></html>".repeat(40);
    let c = compress(html.as_bytes());
    assert!(c.len() < html.len(), "expected shrinkage, got {} for {}", c.len(), html.len());
}

#[test]
fn store_put_get_roundtrip() {
    let dir = std::env::temp_dir().join(format!("cem_test_{}", std::process::id()));
    let c = Cemetery::open(&dir).expect("open");
    let k = key_for("https://example.com/x");
    let payload = br#"{"url":"https://example.com/x","scroll":{"y":2140}}"#;
    c.put(k, payload).expect("put");
    let got = c.get(k).expect("get");
    assert_eq!(got, payload);
    assert_eq!(c.keys(), vec![k]);
    // warm: only one key present
    assert_eq!(c.warm_next(3), vec![k]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn store_eviction_at_capacity() {
    let dir = std::env::temp_dir().join(format!("cem_evict_{}", std::process::id()));
    let c = Cemetery::open(&dir).expect("open");
    for i in 0..70u32 {
        c.put(i, format!("payload-{}", i).as_bytes()).expect("put");
    }
    // max_slots is 64: keys must stay bounded
    assert!(c.keys().len() <= 64, "keys grew to {}", c.keys().len());
    let _ = std::fs::remove_dir_all(&dir);
}
