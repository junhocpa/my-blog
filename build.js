// 마크다운 → 정적 블로그 빌드 스크립트 (의존성 0, Node.js 내장 모듈만 사용)
// 사용법: node build.js
'use strict';

const fs = require('fs');
const path = require('path');

/* ==========================================================================
   설정
   ========================================================================== */

const SITE_TITLE = 'My Blog';
const SITE_DESCRIPTION = '마크다운으로 쓰는 개인 블로그';

const ROOT = __dirname;
const POSTS_DIR = path.join(ROOT, 'posts');
const SRC_DIR = path.join(ROOT, 'src');
const TEMPLATES_DIR = path.join(SRC_DIR, 'templates');
const DIST_DIR = path.join(ROOT, 'dist');

/* ==========================================================================
   공통 유틸
   ========================================================================== */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// {{key}} 플레이스홀더 치환. 값에 $가 있어도 안전하도록 함수 치환 사용.
function render(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (m, key) =>
    data[key] !== undefined ? data[key] : ''
  );
}

function formatDateKorean(iso) {
  const [y, mo, d] = iso.split('-').map(Number);
  return `${y}년 ${mo}월 ${d}일`;
}

/* ==========================================================================
   프런트매터 파서
   ========================================================================== */

function parseFrontmatter(raw, filename) {
  const meta = {};
  let body = raw;

  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) {
    body = raw.slice(m[0].length);
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1];
      const value = kv[2].trim();
      if (key === 'tags') {
        meta.tags = value
          .replace(/^\[/, '')
          .replace(/\]$/, '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
      } else {
        meta[key] = value;
      }
    }
  }

  // title/date 누락 시 파일명(YYYY-MM-DD-slug.md)에서 유추
  const fnMatch = filename.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
  if (!meta.date) {
    console.warn(`[경고] ${filename}: date가 없어 파일명에서 유추합니다.`);
    meta.date = fnMatch ? fnMatch[1] : '1970-01-01';
  }
  if (!meta.title) {
    console.warn(`[경고] ${filename}: title이 없어 파일명에서 유추합니다.`);
    meta.title = fnMatch ? fnMatch[2].replace(/-/g, ' ') : filename;
  }
  meta.tags = meta.tags || [];
  meta.description = meta.description || '';
  meta.slug = filename.replace(/\.md$/, '');

  return { meta, body };
}

/* ==========================================================================
   구문 하이라이터 (정규식 기반 경량 토크나이저)
   규칙 배열 순서 = 우선순위. 내부 그룹은 반드시 (?:...)만 사용한다.
   ========================================================================== */

const JS_RULES = [
  { type: 'comment', re: /\/\/[^\n]*|\/\*[\s\S]*?\*\// },
  { type: 'string', re: /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/ },
  { type: 'keyword', re: /\b(?:const|let|var|function|return|if|else|for|while|do|class|extends|new|import|export|from|default|async|await|try|catch|finally|throw|switch|case|break|continue|typeof|instanceof|of|in|this|super|null|undefined|true|false|static|get|set|yield|delete|void|interface|type|enum|implements|readonly|public|private|protected)\b/ },
  { type: 'number', re: /\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?\b/ },
  { type: 'function', re: /\b[A-Za-z_$][\w$]*(?=\s*\()/ },
];

const PYTHON_RULES = [
  { type: 'comment', re: /#[^\n]*/ },
  { type: 'string', re: /"""[\s\S]*?"""|'''[\s\S]*?'''|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/ },
  { type: 'keyword', re: /\b(?:def|class|return|if|elif|else|for|while|in|not|and|or|import|from|as|with|try|except|finally|raise|lambda|pass|break|continue|global|nonlocal|yield|assert|del|is|None|True|False|async|await|self|match|case)\b/ },
  { type: 'number', re: /\b\d+(?:\.\d+)?\b/ },
  { type: 'function', re: /\b[A-Za-z_][\w]*(?=\s*\()/ },
];

const HTML_RULES = [
  { type: 'comment', re: /<!--[\s\S]*?-->/ },
  { type: 'string', re: /"[^"]*"|'[^']*'/ },
  { type: 'keyword', re: /<\/?[a-zA-Z][\w-]*|\/?>/ },
  { type: 'function', re: /\b[a-zA-Z-]+(?==)/ },
];

const CSS_RULES = [
  { type: 'comment', re: /\/\*[\s\S]*?\*\// },
  { type: 'string', re: /"[^"]*"|'[^']*'/ },
  { type: 'keyword', re: /@[\w-]+|[a-zA-Z-]+(?=\s*:)/ },
  { type: 'number', re: /#[0-9a-fA-F]{3,8}\b|-?\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms|fr|deg)?\b/ },
  { type: 'function', re: /[\w-]+(?=\()/ },
];

const JSON_RULES = [
  { type: 'keyword', re: /"(?:[^"\\]|\\.)*"(?=\s*:)/ },
  { type: 'string', re: /"(?:[^"\\]|\\.)*"/ },
  { type: 'number', re: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/ },
  { type: 'function', re: /\b(?:true|false|null)\b/ },
];

const BASH_RULES = [
  { type: 'comment', re: /#[^\n]*/ },
  { type: 'string', re: /"(?:[^"\\]|\\.)*"|'[^']*'/ },
  { type: 'keyword', re: /\b(?:if|then|else|elif|fi|for|in|do|done|while|case|esac|function|echo|cd|ls|mkdir|rm|cp|mv|export|return|exit|local|source|sudo|git|node|npm)\b/ },
  { type: 'function', re: /\$\{[^}]+\}|\$\w+/ },
  { type: 'number', re: /\b\d+\b/ },
];

const LANGUAGES = {
  js: JS_RULES,
  javascript: JS_RULES,
  ts: JS_RULES,
  typescript: JS_RULES,
  py: PYTHON_RULES,
  python: PYTHON_RULES,
  html: HTML_RULES,
  xml: HTML_RULES,
  css: CSS_RULES,
  json: JSON_RULES,
  bash: BASH_RULES,
  sh: BASH_RULES,
  shell: BASH_RULES,
};

function highlight(code, lang) {
  const rules = LANGUAGES[lang];
  if (!rules) return escapeHtml(code);

  const combined = new RegExp(
    rules.map((r) => '(' + r.re.source + ')').join('|'),
    'g'
  );

  let out = '';
  let last = 0;
  let m;
  while ((m = combined.exec(code)) !== null) {
    out += escapeHtml(code.slice(last, m.index));
    const groupIndex = m.slice(1).findIndex((g) => g !== undefined);
    out += `<span class="tok-${rules[groupIndex].type}">${escapeHtml(m[0])}</span>`;
    last = m.index + m[0].length;
    if (m[0].length === 0) combined.lastIndex++; // 무한 루프 방지
  }
  out += escapeHtml(code.slice(last));
  return out;
}

/* ==========================================================================
   마크다운 파서 — 블록 → 인라인 2단계
   ========================================================================== */

// 인라인: 코드 스팬을 먼저 분리한 뒤 나머지에 서식 적용
function parseInline(text) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts
    .map((part) => {
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      let s = escapeHtml(part);
      s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">');
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
      return s;
    })
    .join('');
}

function isTableSeparator(line) {
  return /^\s*\|?(\s*:?-{3,}:?\s*\|)*\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}

function isBlockStart(line) {
  return (
    /^#{1,6}\s/.test(line) ||
    /^```/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*([-*+]|\d+\.)\s+/.test(line) ||
    /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
  );
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

// 목록: 들여쓰기 2칸 이상이면 직전 항목의 하위 목록(중첩 1단계)
function renderList(lines) {
  const items = [];
  const ordered = /^\s*\d+\./.test(lines[0]);

  for (const raw of lines) {
    const m = raw.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    if (indent >= 2 && items.length > 0) {
      const parent = items[items.length - 1];
      if (!parent.children) {
        parent.children = { ordered: /^\d+\./.test(m[2]), items: [] };
      }
      parent.children.items.push(m[3]);
    } else {
      items.push({ text: m[3] });
    }
  }

  const tag = ordered ? 'ol' : 'ul';
  let out = `<${tag}>`;
  for (const item of items) {
    out += `<li>${parseInline(item.text)}`;
    if (item.children) {
      const childTag = item.children.ordered ? 'ol' : 'ul';
      out += `<${childTag}>`;
      out += item.children.items.map((c) => `<li>${parseInline(c)}</li>`).join('');
      out += `</${childTag}>`;
    }
    out += '</li>';
  }
  out += `</${tag}>`;
  return out;
}

function renderTable(lines) {
  const header = splitTableRow(lines[0]);
  const aligns = splitTableRow(lines[1]).map((sep) => {
    const left = sep.startsWith(':');
    const right = sep.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return '';
  });
  const alignAttr = (i) => (aligns[i] ? ` style="text-align:${aligns[i]}"` : '');

  let out = '<div class="table-wrap"><table><thead><tr>';
  out += header.map((h, i) => `<th${alignAttr(i)}>${parseInline(h)}</th>`).join('');
  out += '</tr></thead><tbody>';
  for (const row of lines.slice(2)) {
    const cells = splitTableRow(row);
    out += '<tr>';
    out += header
      .map((_, i) => `<td${alignAttr(i)}>${parseInline(cells[i] || '')}</td>`)
      .join('');
    out += '</tr>';
  }
  out += '</tbody></table></div>';
  return out;
}

function parseMarkdown(md) {
  const lines = md.split(/\r?\n/);
  const html = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // 코드 블록 (```lang)
    let m = line.match(/^```(\S*)\s*$/);
    if (m) {
      const lang = m[1].toLowerCase();
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 닫는 ``` 건너뛰기
      const code = buf.join('\n');
      html.push(
        `<pre><code class="language-${lang || 'text'}">${highlight(code, lang)}</code></pre>`
      );
      continue;
    }

    // 제목
    m = line.match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      const level = m[1].length;
      html.push(`<h${level}>${parseInline(m[2])}</h${level}>`);
      i++;
      continue;
    }

    // 수평선
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      html.push('<hr>');
      i++;
      continue;
    }

    // 인용문 (내부는 재귀 파싱)
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      html.push(`<blockquote>${parseMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // 목록
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      html.push(renderList(buf));
      continue;
    }

    // 표 (GFM)
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const buf = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        buf.push(lines[i]);
        i++;
      }
      html.push(renderTable(buf));
      continue;
    }

    // 문단 (연속된 일반 줄 묶음)
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    html.push(`<p>${parseInline(buf.join(' '))}</p>`);
  }

  return html.join('\n');
}

/* ==========================================================================
   페이지 생성
   ========================================================================== */

function tagChipsHtml(tags) {
  return tags
    .map((t) => `<span class="post-tag">${escapeHtml(t)}</span>`)
    .join('');
}

function buildPrevNext(older, newer) {
  let out = '';
  if (older) {
    out += `<a class="post-nav-link prev" href="${escapeHtml(older.slug)}.html">` +
      `<span class="post-nav-label">← 이전 글</span>` +
      `<span class="post-nav-title">${escapeHtml(older.title)}</span></a>`;
  }
  if (newer) {
    out += `<a class="post-nav-link next" href="${escapeHtml(newer.slug)}.html">` +
      `<span class="post-nav-label">다음 글 →</span>` +
      `<span class="post-nav-title">${escapeHtml(newer.title)}</span></a>`;
  }
  return out;
}

function main() {
  const year = new Date().getFullYear();

  const indexTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'index.html'), 'utf8');
  const postTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'post.html'), 'utf8');

  // 글 읽기 + 파싱
  const files = fs
    .readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const posts = files.map((filename) => {
    const raw = fs.readFileSync(path.join(POSTS_DIR, filename), 'utf8');
    const { meta, body } = parseFrontmatter(raw, filename);
    return {
      ...meta,
      content: parseMarkdown(body),
    };
  });

  // 최신 글 먼저 (date 내림차순, 동일 날짜는 파일명 내림차순)
  posts.sort((a, b) => (b.date + b.slug).localeCompare(a.date + a.slug));

  // dist 초기화
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST_DIR, 'posts'), { recursive: true });
  fs.mkdirSync(path.join(DIST_DIR, 'assets'), { recursive: true });

  // 개별 글 페이지
  posts.forEach((post, idx) => {
    const newer = idx > 0 ? posts[idx - 1] : null;
    const older = idx < posts.length - 1 ? posts[idx + 1] : null;

    const html = render(postTemplate, {
      siteTitle: escapeHtml(SITE_TITLE),
      title: escapeHtml(post.title),
      description: escapeHtml(post.description),
      date: post.date,
      dateFormatted: formatDateKorean(post.date),
      tagChips: tagChipsHtml(post.tags),
      content: post.content,
      prevNext: buildPrevNext(older, newer),
      root: '../',
      year,
    });

    fs.writeFileSync(path.join(DIST_DIR, 'posts', `${post.slug}.html`), html);
  });

  // 글 목록 페이지
  const postListHtml = posts
    .map((post) => {
      const tagsAttr = escapeHtml(post.tags.join(' '));
      return (
        `<li class="post-item" data-tags="${tagsAttr}">` +
        `<a class="post-link" href="posts/${escapeHtml(post.slug)}.html">` +
        `<h2 class="post-item-title">${escapeHtml(post.title)}</h2>` +
        (post.description
          ? `<p class="post-item-desc">${escapeHtml(post.description)}</p>`
          : '') +
        `<p class="post-meta"><time datetime="${post.date}">${formatDateKorean(post.date)}</time>` +
        tagChipsHtml(post.tags) +
        `</p></a></li>`
      );
    })
    .join('\n');

  const allTags = [...new Set(posts.flatMap((p) => p.tags))].sort();
  const tagListHtml = allTags
    .map(
      (t) =>
        `<button class="tag-chip" type="button" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`
    )
    .join('');

  const indexHtml = render(indexTemplate, {
    siteTitle: escapeHtml(SITE_TITLE),
    siteDescription: escapeHtml(SITE_DESCRIPTION),
    postList: postListHtml,
    tagList: tagListHtml,
    root: '',
    year,
  });
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), indexHtml);

  // 정적 자산 복사
  fs.copyFileSync(path.join(SRC_DIR, 'style.css'), path.join(DIST_DIR, 'assets', 'style.css'));
  fs.copyFileSync(path.join(SRC_DIR, 'main.js'), path.join(DIST_DIR, 'assets', 'main.js'));

  console.log(`빌드 완료: 글 ${posts.length}편, 태그 ${allTags.length}개 → dist/`);
}

main();
