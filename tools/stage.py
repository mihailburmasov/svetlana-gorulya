"""Готовит превью для GitHub Pages: копирует site/ в dist/ с правками под подпапку.

- корневые пути (/css/..., /about) получают префикс --base (/<имя репозитория>);
- все страницы закрыты от индексации, robots.txt запрещает всё;
- Яндекс Метрика отключена, чтобы превью не портило статистику боевого сайта.

Боевой сайт отсюда не деплоится.
Запуск: python -I tools/stage.py --base /svetlana-gorulya
"""

import argparse
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "site"
DIST = ROOT / "dist"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="")
    base = ap.parse_args().base.rstrip("/")

    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(SRC, DIST)

    for f in DIST.rglob("*.html"):
        s = f.read_text(encoding="utf-8")
        s = re.sub(r'((?:href|src)=")/(?!/)', r"\1" + base + "/", s)
        s = s.replace("url(&quot;/uploads/", "url(&quot;" + base + "/uploads/")
        s = re.sub(r'<meta name="robots"[^>]*>', "", s)
        s = s.replace("<head>", '<head>\n<meta name="robots" content="noindex, nofollow">', 1)
        f.write_text(s, encoding="utf-8")

    js = DIST / "js" / "site.js"
    s = js.read_text(encoding="utf-8")
    s = s.replace('href="/', 'href="' + base + "/")
    s = re.sub(r"var METRIKA_ID = \d+;", "var METRIKA_ID = null;", s)
    js.write_text(s, encoding="utf-8")

    for name in ["css/main.css", "favicon/site.webmanifest"]:
        p = DIST / name
        p.write_text(re.sub(r'(url\(["\']?|"src"\s*:\s*")/(?!/)', r"\1" + base + "/",
                            p.read_text(encoding="utf-8")), encoding="utf-8")

    (DIST / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
    (DIST / "sitemap.xml").unlink()
    (DIST / ".nojekyll").write_text("", encoding="utf-8")
    print("Превью готово:", DIST)


if __name__ == "__main__":
    main()
