import re
import os

path = r"c:\BluKaam Conection Startup\blukamm web code\index.html"
with open(path, 'r', encoding='utf-8') as f:
    html = f.read()

# Extract and remove style
style_match = re.search(r'<style>(.*?)</style>', html, re.DOTALL)
if style_match:
    style_content = style_match.group(1).strip()
    with open(r"c:\BluKaam Conection Startup\blukamm web code\style.css", 'w', encoding='utf-8') as f:
        f.write(style_content)
    html = html[:style_match.start()] + '<link rel="stylesheet" href="style.css">' + html[style_match.end():]

# Extract and remove script
script_match = re.search(r'<script>(.*?)</script>', html, re.DOTALL)
if script_match:
    script_content = script_match.group(1).strip()
    with open(r"c:\BluKaam Conection Startup\blukamm web code\script.js", 'w', encoding='utf-8') as f:
        f.write(script_content)
    html = html[:script_match.start()] + '<script src="script.js"></script>' + html[script_match.end():]

with open(path, 'w', encoding='utf-8') as f:
    f.write(html)

print("Split completed.")
