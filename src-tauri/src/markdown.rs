//! Markdown preview rendering with comrak (CommonMark + GFM). Raw HTML in
//! notes is escaped, and unsafe link schemes are dropped, so the preview
//! can be inserted into the UI without running anything from the note.

use comrak::{markdown_to_html, Options};

pub fn render(text: &str) -> String {
    let mut opts = Options::default();
    let ext = &mut opts.extension;
    ext.strikethrough = true;
    ext.table = true;
    ext.autolink = true;
    ext.tasklist = true;
    ext.footnotes = true;
    ext.front_matter_delimiter = Some("---".to_owned());
    ext.wikilinks_title_after_pipe = true;
    ext.math_dollars = true;
    opts.render.r#unsafe = false;
    markdown_to_html(text, &opts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_wikilinks_and_drops_html() {
        let html = render("---\ntitle: x\n---\n# Hi\n\n[[Other note|shown]] <script>alert(1)</script>\n\n[x](javascript:alert(1))");
        assert!(html.contains("<h1>Hi</h1>"), "{html}");
        assert!(!html.contains("title: x"), "{html}");
        assert!(html.contains("data-wikilink=\"true\""), "{html}");
        assert!(html.contains(">shown</a>"), "{html}");
        assert!(!html.contains("<script>"), "{html}");
        assert!(!html.contains("javascript:"), "{html}");
    }
}
