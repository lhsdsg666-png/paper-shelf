import { unzipSync } from 'fflate';
import { parseDocument } from 'htmlparser2';

const MB = 1024 * 1024;
const maxFile = 32 * MB;
const maxImport = 300 * MB;
const maxEntries = 10000;
const textTypes = new Set(['txt', 'md', 'markdown']);
const imageTypes = new Map([
  ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'],
  ['gif', 'image/gif'], ['webp', 'image/webp'], ['avif', 'image/avif'], ['bmp', 'image/bmp']
]);
const alphabetic = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const chapterHeading = /^(?:第\s*[零〇一二两三四五六七八九十百千万0-9０-９]+\s*[章节卷回部集]|[Cc]hapter\s+\d+\b|[Pp]rologue\b|[Ee]pilogue\b|序[章言幕]|楔子|尾声|后记|番外)/u;
const markdownImage = /!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/gu;
const safeElements = new Set('p div section h1 h2 h3 h4 h5 h6 blockquote ul ol li dl dt dd em strong i b u s del sub sup ruby rp rt pre code br hr figure figcaption table tr tbody thead tfoot td th caption span'.split(' '));
const discardedElements = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'textarea', 'input', 'button', 'link', 'meta', 'audio', 'video']);

const fileName = path => path.slice(path.lastIndexOf('/') + 1);
const directory = path => path.slice(0, path.lastIndexOf('/') + 1);
const extension = path => /\.([^.\/]+)$/.exec(path)?.[1].toLowerCase();
const stem = path => fileName(path).replace(/\.[^.]+$/, '');
const normalKey = value => value.normalize('NFC').toLowerCase();
const coverName = /^(?:cover(?:[-_ ](?:image|art|front))?|folder|封面)$/i;

function safePath(path) {
  const parts = path.replaceAll('\\', '/').split('/');
  if (parts.some(part => part === '..' || /[\u0000-\u001f]/u.test(part))) return null;
  return parts.filter(part => part && part !== '.').join('/').normalize('NFC');
}

function localPath(from, reference) {
  const raw = reference?.trim().split(/[?#]/, 1)[0];
  if (!raw || /^(?:[a-z][\w+.-]*:|[\/\\])/i.test(raw)) return null;
  const target = directory(from).split('/').filter(Boolean);
  for (const part of raw.replaceAll('\\', '/').split('/')) {
    let decoded = part;
    try { decoded = decodeURIComponent(part); } catch {}
    if (/[\/\\\u0000-\u001f]/u.test(decoded)) return null;
    if (decoded === '..') {
      if (!target.length) return null;
      target.pop();
    } else if (decoded && decoded !== '.') {
      target.push(decoded);
    }
  }
  return target.join('/').normalize('NFC');
}

const relevantFile = path => textTypes.has(extension(path)) || imageTypes.has(extension(path)) || extension(path) === 'epub';
const isMetadata = path => /(?:^|\/)(?:__MACOSX|\.DS_Store|Thumbs\.db)(?:\/|$)/i.test(path);

async function expandZip(file, keep) {
  const expanded = new Map();
  let total = 0;
  let entries = 0;
  if (file.size > maxImport) throw new Error('压缩包超过 300 MB。');
  const contents = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter(info) {
      if (++entries > maxEntries) throw new Error('压缩包内的文件太多。');
      const path = safePath(info.name);
      if (!path || /[\/\\]$/.test(info.name) || isMetadata(path) || !keep(path)) return false;
      total += info.originalSize;
      if (total > maxImport || info.originalSize > maxFile) throw new Error('解压后的文件超过导入上限。');
      return true;
    }
  });
  total = 0;
  for (const [name, bytes] of Object.entries(contents)) {
    const path = safePath(name);
    total += bytes.byteLength;
    if (total > maxImport || bytes.byteLength > maxFile) throw new Error('解压后的文件超过导入上限。');
    expanded.set(path, new Blob([bytes], { type: imageTypes.get(extension(path)) || '' }));
  }
  return expanded;
}

export async function collect(files) {
  const groups = [];
  const plain = new Map();
  const warnings = [];
  let total = 0;
  for (const file of files) {
    const path = safePath(file.webkitRelativePath || file.relativePath || file.name);
    if (!path || isMetadata(path)) continue;
    if (extension(path) === 'zip') {
      try {
        groups.push({ label: stem(path), files: await expandZip(file, relevantFile) });
      } catch (error) {
        warnings.push(fileName(path) + '：' + (error instanceof Error ? error.message : '无法解压。'));
      }
    } else if (relevantFile(path)) {
      total += file.size;
      if (file.size > maxFile) {
        warnings.push(fileName(path) + '：文件超过 32 MB。');
      } else {
        plain.set(path, file);
      }
    }
  }
  if (total > maxImport || plain.size > maxEntries) throw new Error('本次选择内容较多，请分批导入（每批最多 300 MB）。');
  if (plain.size) {
    const roots = new Set([...plain.keys()].map(path => path.includes('/') ? path.split('/')[0] : ''));
    groups.unshift({ label: roots.size === 1 ? [...roots][0] : '', files: plain });
  }
  return { groups, warnings };
}

export function countTexts(group) {
  return [...group.files.keys()].filter(path => textTypes.has(extension(path))).length;
}

async function decode(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  for (const [first, second, encoding] of [[0xff, 0xfe, 'utf-16le'], [0xfe, 0xff, 'utf-16be']]) {
    if (bytes[0] === first && bytes[1] === second) return new TextDecoder(encoding).decode(bytes);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030').decode(bytes);
  }
}

async function hash(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
}

const textBlock = (value, tag = 'p') => ({ tag, children: [value] });
const illustration = (path, alt) => ({ image: path, alt });

function textChapters(source, path, findImage, title) {
  const chapters = [];
  const isMarkdown = extension(path) !== 'txt';
  let currentTitle = title;
  let blocks = [];
  let length = 0;
  let pendingHeading = false;
  function finish() {
    if (blocks.length || pendingHeading) chapters.push({ title: currentTitle, blocks, length: Math.max(1, length) });
    blocks = [];
    length = 0;
    pendingHeading = false;
  }
  for (const line of source.split(/\r\n?|\n|\u2028|\u2029/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = isMarkdown ? /^#{1,6}\s+(.+)$/u.exec(trimmed) : null;
    if (heading || (trimmed.length <= 58 && chapterHeading.test(trimmed))) {
      finish();
      currentTitle = heading?.[1] || trimmed;
      pendingHeading = true;
      continue;
    }
    for (const fragment of trimmed.match(/.{1,3400}/gu) ?? []) {
      if (length >= 6200) {
        finish();
        currentTitle = currentTitle.replace(/· 续$/, '') + ' · 续';
      }
      const pieces = [];
      let last = 0;
      for (const match of fragment.matchAll(markdownImage)) {
        const image = findImage(path, match[2] || match[3]);
        if (!image) continue;
        if (match.index > last) pieces.push(textBlock(fragment.slice(last, match.index)));
        pieces.push(illustration(image, match[1]));
        last = match.index + match[0].length;
      }
      if (!last) {
        const marker = /^(?:[【\[]\s*)?(?:插图|图片)\s*[:：]\s*(.+?)(?:\s*[】\]])?$/u.exec(fragment);
        const image = marker && findImage(path, marker[1]);
        if (image) pieces.push(illustration(image, ''));
      }
      if (last < fragment.length && (last || !pieces.length)) pieces.push(textBlock(fragment.slice(last)));
      blocks.push(...pieces);
      length += fragment.length;
    }
  }
  finish();
  return chapters;
}

function relatedImages(paths, titles, images) {
  const names = new Set(titles.map(path => normalKey(stem(path))));
  return [...images.keys()].filter(image => paths.some(path => {
    const parent = directory(path);
    if (!image.startsWith(parent)) return false;
    const folder = image.slice(parent.length).split('/')[0];
    const name = normalKey(stem(image));
    return !names.has(normalKey(folder)) && !names.has(name)
      || normalKey(folder) === normalKey(stem(path)) || name === normalKey(stem(path));
  }));
}

function asImage(blob, path) {
  return blob.slice(0, blob.size, imageTypes.get(extension(path)));
}

async function textBook(paths, files, allTexts, label) {
  const images = new Map([...files].filter(([path]) => imageTypes.has(extension(path))));
  const lookup = new Map([...images.keys()].map(path => [normalKey(path), path]));
  const used = new Set(relatedImages(paths, allTexts, images));
  const title = paths.length === 1 ? stem(paths[0]) : (label || directory(paths[0]).split('/').at(-2) || stem(paths[0]));
  const chapters = [];
  const fingerprints = [];
  for (const path of paths) {
    const source = await decode(files.get(path));
    fingerprints.push([fileName(path), await hash(new TextEncoder().encode(source))]);
    const child = textChapters(source, path, (from, ref) => {
      const image = lookup.get(normalKey(localPath(from, ref) || ''));
      if (image) used.add(image);
      return image;
    }, paths.length === 1 ? '正文' : stem(path));
    chapters.push(...child);
  }
  if (!chapters.length) throw new Error('文件夹里的小说没有可读内容。');
  const assets = [...used].sort(alphabetic.compare).map(path => ({ path, blob: asImage(images.get(path), path) }));
  const cover = assets.find(asset => normalKey(stem(asset.path)) === normalKey(title))
    || assets.find(asset => coverName.test(stem(asset.path))) || assets[0];
  const id = await hash(new TextEncoder().encode(JSON.stringify(fingerprints)));
  return { id, title, author: '', format: paths.length === 1 && extension(paths[0]) !== 'txt' ? 'MD' : 'TXT', chapters, assets, cover };
}

// Parse imported markup into inert JavaScript nodes. No imported HTML or URL is
// added to the live document. The reader builds its own allowed DOM elements.
const parse = (source, xmlMode = false) => parseDocument(source, { xmlMode });
const nameOf = node => node?.name?.split(':').at(-1);
function* elements(node, ...names) {
  for (const child of node?.children || []) {
    if (names.includes(nameOf(child))) yield child;
    yield* elements(child, ...names);
  }
}

function textOf(node) {
  if (node?.type === 'text') return node.data;
  return node?.children?.map(textOf).join('') || '';
}

async function markup(files, path, xmlMode = false) {
  const file = files.get(path);
  return file ? parse(await decode(file), xmlMode) : null;
}

function safeContent(node, page, images, depth = 0) {
  if (depth > 100) return [];
  if (node.type === 'text') return [node.data];
  const name = nameOf(node);
  if (!name || discardedElements.has(name) || node.attribs?.hidden !== undefined) return [];
  if (name === 'img' || name === 'image') {
    const source = node.attribs.src || node.attribs['xlink:href'] || node.attribs.href;
    const path = localPath(page, source);
    return images.has(path) ? [illustration(path, node.attribs.alt || '')] : [];
  }
  const children = (node.children || []).flatMap(child => safeContent(child, page, images, depth + 1));
  if (!safeElements.has(name)) return children;
  return [{ tag: name, children }];
}

const chapterText = child => typeof child === 'string' ? child : (child.children || []).map(chapterText).join('');
const hasImage = child => typeof child !== 'string' && (child.image || child.children?.some(hasImage));

async function epubBook(path, file, folder, novels) {
  const files = await expandZip(file, candidate => /\.(?:xml|opf|ncx|x?html?|svg)$/i.test(candidate) || imageTypes.has(extension(candidate)));
  const container = await markup(files, 'META-INF/container.xml', true);
  const root = [...elements(container, 'rootfile')][0];
  const opfPath = localPath('', root?.attribs['full-path']);
  const opf = await markup(files, opfPath, true);
  const spine = [...elements(opf, 'spine')][0];
  if (!spine) throw new Error('找不到 EPUB 的阅读顺序。');
  const metadata = [...elements(opf, 'metadata')][0];
  const manifest = new Map([...elements(opf, 'item')].map(node => [node.attribs.id, node.attribs]));
  const title = textOf([...elements(metadata, 'title')][0]).trim() || stem(path);
  const author = textOf([...elements(metadata, 'creator')][0]).trim();
  const images = new Map([...files].filter(([candidate]) => imageTypes.has(extension(candidate))));
  const nav = [...manifest.values()].find(item => item.properties?.split(/\s+/).includes('nav'));
  const names = new Map();
  if (nav) {
    const navPath = localPath(opfPath, nav.href);
    const document = await markup(files, navPath);
    const toc = [...elements(document, 'nav')].find(node => node.attribs['epub:type']?.split(/\s+/).includes('toc')) || document;
    for (const link of elements(toc, 'a')) {
      const href = localPath(navPath, link.attribs.href);
      if (href && !names.has(href)) names.set(href, textOf(link).trim());
    }
  } else {
    const ncxPath = localPath(opfPath, manifest.get(spine.attribs.toc)?.href);
    const document = await markup(files, ncxPath, true);
    for (const point of elements(document, 'navPoint')) {
      const link = point.children.find(child => nameOf(child) === 'content');
      const label = point.children.find(child => nameOf(child) === 'navLabel');
      const href = localPath(ncxPath, link?.attribs.src);
      if (href && !names.has(href)) names.set(href, textOf(label).trim());
    }
  }
  const chapters = [];
  for (const item of elements(spine, 'itemref')) {
    const manifestItem = manifest.get(item.attribs.idref);
    const page = localPath(opfPath, manifestItem?.href);
    if (!page || !files.has(page)) continue;
    if (images.has(page)) {
      chapters.push({ title: names.get(page) || stem(page), blocks: [illustration(page, '')], length: 1 });
      continue;
    }
    if (!/\.(?:html?|xhtml|svg)$/i.test(page) && manifestItem['media-type'] !== 'application/xhtml+xml') continue;
    const document = await markup(files, page);
    const body = [...elements(document, 'body')][0] || document;
    const blocks = body.children.flatMap(node => safeContent(node, page, images));
    const contents = blocks.map(chapterText).join('').trim();
    if (!contents && !blocks.some(hasImage)) continue;
    const firstHeading = [...elements(body, 'h1', 'h2', 'h3')][0];
    const label = names.get(page) || textOf(firstHeading).trim().slice(0, 160) || '章节 ' + (chapters.length + 1);
    const headingIndex = blocks.findIndex(block => ['h1', 'h2', 'h3'].includes(block.tag) && chapterText(block).trim() === label);
    if (headingIndex !== -1) blocks.splice(headingIndex, 1);
    chapters.push({ title: label, blocks, length: contents.length || 1 });
  }
  if (!chapters.length) throw new Error('没有可读章节，文件可能带有 DRM 保护或已损坏。');
  const coverId = [...elements(metadata, 'meta')].find(node => node.attribs.name === 'cover')?.attribs.content;
  const coverItem = manifest.get(coverId) || [...manifest.values()].find(item => item.properties?.split(/\s+/).includes('cover-image'));
  const coverPath = localPath(opfPath, coverItem?.href);
  const external = new Map([...folder].filter(([candidate]) => imageTypes.has(extension(candidate))));
  const attachments = relatedImages([path], novels, external).map(candidate => ({
    path: '文件夹插图/' + candidate, blob: asImage(external.get(candidate), candidate)
  }));
  const assets = [...images].map(([path, blob]) => ({ path, blob })).concat(attachments);
  const cover = assets.find(asset => asset.path === coverPath) || assets.find(asset => coverName.test(stem(asset.path))) || assets[0];
  return { id: await hash(await file.arrayBuffer()), title, author, format: 'EPUB', chapters, assets, cover };
}

export async function* readGroup(group, merge) {
  const paths = [...group.files.keys()].sort(alphabetic.compare);
  const texts = paths.filter(path => textTypes.has(extension(path)));
  const epubs = paths.filter(path => extension(path) === 'epub');
  const novels = [...texts, ...epubs];
  const units = merge && texts.length > 1 ? [texts] : texts.map(path => [path]);
  for (const path of epubs) units.push([path]);
  for (const unit of units) {
    const path = unit[0];
    try {
      const book = extension(path) === 'epub'
        ? await epubBook(path, group.files.get(path), group.files, novels)
        : await textBook(unit, group.files, novels, group.label);
      yield { book };
    } catch (error) {
      yield { warning: fileName(path) + '：' + (error instanceof Error ? error.message : '无法读取。') };
    }
  }
}

export async function droppedFiles(transfer) {
  const items = [...transfer.items].filter(item => item.kind === 'file');
  const entries = items.map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length !== items.length || !entries.length) return [...transfer.files];
  const files = [];
  let entriesRead = 0;
  async function visit(entry) {
    if (++entriesRead > maxEntries) throw new Error('目录里的文件太多，请分批导入。');
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      file.relativePath = entry.fullPath.slice(1);
      files.push(file);
      return;
    }
    const reader = entry.createReader();
    while (true) {
      const children = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!children.length) break;
      for (const child of children) await visit(child);
    }
  }
  for (const entry of entries) await visit(entry);
  return files;
}
