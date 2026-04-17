const fs = require('fs');
const path = require('path');

const viewsDir = path.join(__dirname, 'views');
const layoutsDir = path.join(viewsDir, 'layouts');

if (!fs.existsSync(layoutsDir)) {
  fs.mkdirSync(layoutsDir);
}

const baseNjk = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>{% block title %}Mesh - Context Compression Platform{% endblock %}</title>
  <link rel="icon" type="image/svg+xml" href="/assets/brand/icon-color.svg"/>
  <link rel="apple-touch-icon" href="/assets/brand/icon-color.svg"/>
  <script src="/assets/anime.min.js"></script>
  {% block head %}{% endblock %}
</head>
<body{% block body_attrs %}{% endblock %}>
  {% block content %}{% endblock %}
</body>
</html>
`;

fs.writeFileSync(path.join(layoutsDir, 'base.njk'), baseNjk);

const files = fs.readdirSync(viewsDir).filter(f => f.endsWith('.html'));

files.forEach(file => {
  const content = fs.readFileSync(path.join(viewsDir, file), 'utf8');

  // Extract title
  let titleMatch = content.match(/<title>([\s\S]*?)<\/title>/);
  let title = titleMatch ? titleMatch[1] : '';

  // Extract head contents MINUS what is in base.njk
  let headMatch = content.match(/<head>([\s\S]*?)<\/head>/i);
  let headContent = headMatch ? headMatch[1] : '';
  headContent = headContent
    .replace(/<meta charset="?[Uu]tf-8"?\s*\/?>/ig, '')
    .replace(/<meta name="viewport"[\s\S]*?>/ig, '')
    .replace(/<title>[\s\S]*?<\/title>/ig, '')
    .replace(/<link rel="icon"[\s\S]*?>/ig, '')
    .replace(/<link rel="apple-touch-icon"[\s\S]*?>/ig, '')
    .replace(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/animejs\/.*?"\s*(defer)?>\s*<\/script>/ig, '') // remove animejs cdn if exists
    .trim();

  // Extract body attributes
  let bodyAttrMatch = content.match(/<body([^>]*)>/i);
  let bodyAttrs = bodyAttrMatch ? bodyAttrMatch[1] : '';

  // Extract content inside body
  let bodyContentMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let bodyContent = bodyContentMatch ? bodyContentMatch[1] : '';

  let njk = `{% extends "layouts/base.njk" %}

{% block title %}${title}{% endblock %}

{% block head %}
${headContent}
{% endblock %}

${bodyAttrs.trim() ? `{% block body_attrs %}${bodyAttrs}{% endblock %}` : ''}
{% block content %}
${bodyContent}
{% endblock %}
`;

  fs.writeFileSync(path.join(viewsDir, file.replace('.html', '.njk')), njk);
  fs.unlinkSync(path.join(viewsDir, file)); // delete .html
});

console.log('Migrated ' + files.length + ' html files to njk.');
