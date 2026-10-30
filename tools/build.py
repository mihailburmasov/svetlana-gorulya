"""Снимает статическую копию gorulya.ru (Nuxt SSR) в папку site/.

Что делает:
- скачивает все страницы из sitemap.xml;
- вырезает скрипты и служебную разметку Nuxt;
- скачивает картинки из Strapi (api.gorulya.ru/uploads), CSS, SVG, favicon и OG-картинки
  и переписывает ссылки на локальные;
- подключает js/site.js (формы, cookie-баннер, Метрика, ВК-видео, полный текст сказки по PIN);
- кладёт robots.txt, sitemap.xml, 404.html.

Запуск: python -I tools/build.py
"""

import os
import re
import sys
import shutil
import urllib.request
from pathlib import Path

ORIGIN = "https://gorulya.ru"
API = "https://api.gorulya.ru"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site"
JS_SRC = ROOT / "tools" / "site.js"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (static-copy)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def save(rel, data):
    p = OUT / rel.lstrip("/")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


downloaded = set()


def download(url, rel):
    if rel in downloaded:
        return
    save(rel, fetch(url))
    downloaded.add(rel)
    print("  +", rel)


def page_paths():
    xml = fetch(ORIGIN + "/sitemap.xml").decode("utf-8")
    locs = re.findall(r"<loc>([^<]+)</loc>", xml)
    return [l.replace(ORIGIN, "") or "/" for l in locs]


def out_file(path):
    return "index.html" if path == "/" else path.strip("/") + "/index.html"


def og_rel(path):
    return "/og/index.png" if path == "/" else "/og/" + path.strip("/") + ".png"


def clean(html, path):
    # скрипты Nuxt (конфиг, данные, og-image, бандлы) и preload бандлов
    html = re.sub(r"<script\b[^>]*>.*?</script>", "", html, flags=re.S)
    html = re.sub(r'<link rel="modulepreload"[^>]*>', "", html)
    # @font-face DejaVu нужен был только генератору OG-картинок, в CSS сайта не используется
    html = re.sub(r"<style>@font-face\{[^<]*DejaVu[^<]*</style>", "", html)
    # служебные комментарии Vue
    html = re.sub(r"<!--\[-->|<!--\]-->|<!---->", "", html)
    # обёртки приложения
    html = html.replace('<div id="__nuxt">', "", 1)
    html = html.replace('</div><div id="teleports"></div>', "", 1)
    # атрибуты-пропсы, утёкшие в разметку
    html = re.sub(r' (?:sourcetype|limit|featuredonly|sort)="[^"]*"', "", html)

    # OG-картинки: генерировались на лету, теперь статика
    def og(m):
        page = (m.group(1) or "").rstrip("/") or "/"
        rel = og_rel(page)
        download(m.group(0), rel)
        return ORIGIN + rel

    html = re.sub(re.escape(ORIGIN) + r"/__og-image__/image(/[^\"]*?)?/og\.png", og, html)

    # картинки из Strapi
    def up(m):
        rel = "/uploads/" + m.group(1)
        download(API + rel, rel)
        return rel

    html = re.sub(re.escape(API) + r"/uploads/([^\"'&)\s]+)", up, html)

    html = html.replace("</body>", '<script src="/js/site.js" defer></script>\n</body>')
    return html


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()

    paths = page_paths()
    print(f"Страниц в sitemap: {len(paths)}")
    for path in paths:
        print(path)
        html = fetch(ORIGIN + path).decode("utf-8")
        save(out_file(path), clean(html, path).encode("utf-8"))

    print("Статика")
    for rel in ["/css/tokens.css", "/css/main.css", "/svg/logo.svg", "/svg/logo_white.svg",
                "/favicon/favicon.svg", "/favicon/favicon.ico", "/favicon/favicon-96x96.png",
                "/favicon/apple-touch-icon.png", "/favicon/site.webmanifest"]:
        download(ORIGIN + rel, rel)
    manifest = (OUT / "favicon/site.webmanifest").read_text(encoding="utf-8")
    for src in re.findall(r'"src"\s*:\s*"([^"]+)"', manifest):
        rel = src if src.startswith("/") else "/favicon/" + src
        download(ORIGIN + rel, rel)
    for css in ["css/tokens.css", "css/main.css"]:
        for u in re.findall(r"url\(['\"]?(/[^'\")]+)", (OUT / css).read_text(encoding="utf-8")):
            download(ORIGIN + u, u)

    # robots.txt без маркеров модуля nuxt-robots
    robots = fetch(ORIGIN + "/robots.txt").decode("utf-8")
    robots = "\n".join(l for l in robots.splitlines() if not l.startswith("# ")).strip() + "\n"
    save("robots.txt", robots.encode("utf-8"))

    # sitemap.xml без xsl-стилей модуля
    locs = "".join(f"  <url>\n    <loc>{ORIGIN}{p}</loc>\n  </url>\n" for p in paths)
    sitemap = ('<?xml version="1.0" encoding="UTF-8"?>\n'
               '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + locs + "</urlset>\n")
    save("sitemap.xml", sitemap.encode("utf-8"))

    # 404 на основе каркаса главной
    home = (OUT / "index.html").read_text(encoding="utf-8")
    head, rest = home.split("<main>", 1)
    _, tail = rest.split("</main>", 1)
    head = re.sub(r"<title>[^<]*</title>", "<title>Страница не найдена — Светлана Горуля</title>", head)
    head = re.sub(r'<meta name="robots"[^>]*>', '<meta name="robots" content="noindex">', head)
    head = re.sub(r'<link rel="canonical"[^>]*>', "", head)
    head = head.replace('aria-current="page" ', "").replace(" router-link-active router-link-exact-active", "")
    tail = tail.replace('aria-current="page" ', "").replace(" router-link-active router-link-exact-active", "")
    body = ('<main><section class="hero-centered"><div class="hero-centered__inner">'
            '<p class="eyebrow">Ошибка 404</p><h1 class="hero-centered__title">Страница не найдена</h1>'
            '<p class="lead">Возможно, адрес изменился или страница была удалена.</p>'
            '<div class="button-group"><a href="/" class="button button--primary">На главную</a></div>'
            "</div></section></main>")
    save("404.html", (head + body + tail).encode("utf-8"))

    (OUT / "js").mkdir(exist_ok=True)
    shutil.copy(JS_SRC, OUT / "js" / "site.js")
    print("Готово:", OUT)


if __name__ == "__main__":
    main()
