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

#[cfg(test)]
mod tests {
    use super::*;

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
