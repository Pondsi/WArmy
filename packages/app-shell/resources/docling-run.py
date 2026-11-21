# R260 项「Docling 增强版面/表格保真」：Docling（IBM，MIT）文档解析子进程脚本。
# 零原生约定：Python/docling 只活在独立子进程；主进程经 IPC 收结构化 Markdown。
# 用法: python docling-run.py <document_path>
# 约定: 成功打印一行 JSON {"ok":true,"markdown":...}；失败/未装打印 {"ok":false,"error":...}（绝不伪造）。
import sys
import json


def fail(msg):
    print(json.dumps({"ok": False, "error": str(msg)[:500]}, ensure_ascii=False))
    sys.exit(0)


def main():
    if len(sys.argv) < 2:
        fail("usage: docling-run.py <document_path>")
    path = sys.argv[1]
    try:
        from docling.document_converter import DocumentConverter
    except Exception as e:
        fail("docling-not-installed: " + str(e) + "（需 pip install docling）")
    try:
        converter = DocumentConverter()
        result = converter.convert(path)
        markdown = result.document.export_to_markdown()
        print(json.dumps({"ok": True, "markdown": markdown}, ensure_ascii=False))
    except Exception as e:
        fail("parse-failed: " + str(e))


if __name__ == "__main__":
    main()