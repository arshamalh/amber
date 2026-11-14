//! LSP base-protocol framing: `Content-Length: N\r\n\r\n<json>`.

use tokio::io::{self, AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// Reads one message body. Returns `Ok(None)` on a clean EOF between messages.
pub async fn read_message<R: AsyncBufRead + Unpin>(r: &mut R) -> io::Result<Option<String>> {
    let mut length: Option<usize> = None;
    let mut line = String::new();
    loop {
        line.clear();
        if r.read_line(&mut line).await? == 0 {
            return if length.is_none() {
                Ok(None)
            } else {
                Err(io::ErrorKind::UnexpectedEof.into())
            };
        }
        let header = line.trim_end_matches(['\r', '\n']);
        if header.is_empty() {
            if length.is_some() {
                break;
            }
            continue; // tolerate stray blank lines between messages
        }
        if let Some((name, value)) = header.split_once(':') {
            if name.trim().eq_ignore_ascii_case("content-length") {
                length = Some(value.trim().parse().map_err(|_| {
                    io::Error::new(io::ErrorKind::InvalidData, "bad Content-Length")
                })?);
            }
        }
    }
    let mut body = vec![0; length.unwrap_or(0)];
    r.read_exact(&mut body).await?;
    String::from_utf8(body)
        .map(Some)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

pub async fn write_message<W: AsyncWrite + Unpin>(w: &mut W, body: &str) -> io::Result<()> {
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    w.write_all(header.as_bytes()).await?;
    w.write_all(body.as_bytes()).await?;
    w.flush().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::BufReader;

    #[tokio::test]
    async fn round_trips_messages() {
        let mut buf = Vec::new();
        write_message(&mut buf, r#"{"a":"é"}"#).await.unwrap();
        write_message(&mut buf, "{}").await.unwrap();
        let mut r = BufReader::new(&buf[..]);
        assert_eq!(read_message(&mut r).await.unwrap().unwrap(), r#"{"a":"é"}"#);
        assert_eq!(read_message(&mut r).await.unwrap().unwrap(), "{}");
        assert!(read_message(&mut r).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn accepts_extra_headers_any_case() {
        let raw = b"content-length: 2\r\nContent-Type: application/vscode-jsonrpc\r\n\r\n{}";
        let mut r = BufReader::new(&raw[..]);
        assert_eq!(read_message(&mut r).await.unwrap().unwrap(), "{}");
    }

    #[tokio::test]
    async fn truncated_body_is_an_error() {
        let raw = b"Content-Length: 10\r\n\r\n{}";
        let mut r = BufReader::new(&raw[..]);
        assert!(read_message(&mut r).await.is_err());
    }
}
