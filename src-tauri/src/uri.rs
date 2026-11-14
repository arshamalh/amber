//! `file://` URIs for LSP. Kept in Rust so the UI never builds paths itself.

use std::path::Path;

pub fn file_uri(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    let drive = !s.starts_with('/');
    let mut out = String::from("file://");
    if drive {
        out.push('/'); // Windows drive paths: file:///C:/...
    }
    for (i, b) in s.bytes().enumerate() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                out.push(b as char)
            }
            b':' if drive && i == 1 => out.push(':'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Decodes `%XX` escapes. Invalid escapes are kept as-is.
pub fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = |c: u8| (c as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Content type for files served to the UI.
pub fn mime_for(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_escapes() {
        assert_eq!(percent_decode("Notes%2Fimg%201.png"), "Notes/img 1.png");
        assert_eq!(percent_decode("%C3%BC"), "ü");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("a%zzb"), "a%zzb");
        assert_eq!(percent_decode("%aé"), "%aé");
    }

    #[test]
    fn encodes_unix_paths() {
        assert_eq!(
            file_uri(Path::new("/home/a/My Notes/ü.typ")),
            "file:///home/a/My%20Notes/%C3%BC.typ"
        );
    }

    #[test]
    fn encodes_windows_paths() {
        assert_eq!(
            file_uri(Path::new(r"C:\Users\a\n#1.typ")),
            "file:///C:/Users/a/n%231.typ"
        );
    }
}
