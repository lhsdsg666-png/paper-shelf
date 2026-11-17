import { collect, countTexts, droppedFiles, readGroup } from './import.js';
import { listBooks, loadBook, openLibrary, removeBook, saveBook, saveProgress } from './storage.js';
import { addIcons } from './icons.js';

const $ = id => document.getElementById(id);
const dialog = $('dialog');
const dialogBody = $('dialog-body');
const grid = $('book-grid');
const article = $('chapter');
const library = openLibrary();
const alphabetic = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const bound = value => clamp(value, 0, 1);
const visible = (element, value) => { element.hidden = !value; };
const make = (tag, className = '', value) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
};
const button = (label, style = 'quiet') => {
  const element = make('button', 'button ' + style, label);
  element.type = 'button';
  return element;
};
const formatError = error => error?.name === 'QuotaExceededError'
  ? '浏览器存储空间不足。请释放空间或减少导入文件。'
  : error?.message || '浏览器无法完成这项操作。';

let books = [];
let coverUrls = [];
let busy = false;
let reader = null;
let routeVersion = 0;
let shelfScroll = 0;
let toastTimer;
let dragDepth = 0;
let installPrompt;
let settings = { theme: 'paper', size: 1 };
try {
  const previous = JSON.parse(localStorage.getItem('paper-shelf:appearance'));
  if (['paper', 'plain', 'night'].includes(previous?.theme) && Number.isInteger(previous.size)) {
    settings = { theme: previous.theme, size: clamp(previous.size, 0, 4) };
  }
} catch {}

function message(text, stay = false) {
  window.clearTimeout(toastTimer);
  $('toast').textContent = text;
  visible($('toast'), true);
  if (!stay) toastTimer = window.setTimeout(() => visible($('toast'), false), 4500);
}

function showDialog(title, children) {
  $('dialog-title').textContent = title;
  dialogBody.replaceChildren(...children);
  dialog.returnValue = '';
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}

function choose(title, description, choices) {
  const actions = make('div', 'dialog-actions');
  const selected = new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
  });
  for (const [label, value, style] of choices) {
    const item = button(label, style);
    item.addEventListener('click', () => dialog.close(value));
    actions.append(item);
  }
  showDialog(title, [make('p', 'dialog-copy', description), actions]);
  return selected;
}

function openPrivacy() {
  const lines = [
    '小说正文、插图和阅读进度保存在当前浏览器。导入与阅读过程都在本机完成，网页不会上传这些内容。',
    '用同一个浏览器打开这个网址即可继续读。其他人用自己的浏览器访问时，只会看到自己的书架。',
    '清除网站数据或使用无痕窗口可能丢失书库。共用同一个浏览器用户配置的人可以打开这份书库，请保留原文件。'
  ];
  showDialog('本地书库', lines.map(line => make('p', 'dialog-copy', line)));
}

async function installApp() {
  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      return;
    } catch {}
  }
  const lines = [
    '安卓｜用 Chrome 打开纸间，点右上角菜单 →「添加到主屏幕」或「安装应用」。',
    'iPhone｜用 Safari 打开纸间，点「分享」→「添加到主屏幕」。如果看到「作为网页 App 打开」，请保持开启。',
    'iPhone 桌面版有自己的本地书架，请从桌面图标打开后导入小说。'
  ];
  showDialog('安装到桌面', lines.map(line => make('p', 'dialog-copy', line)));
}

function coverCard(book) {
  const card = make('article', 'book-card');
  const open = make('button', 'open-book');
  open.type = 'button';
  open.setAttribute('aria-label', '阅读《' + book.title + '》');
  open.addEventListener('click', () => {
    history.pushState({ book: book.id }, '');
    void route();
  });

  const cover = make('div', 'cover');
  cover.dataset.palette = parseInt(book.id.slice(0, 2), 16) % 5;
  const coverType = make('span', 'cover-type', book.format);
  const coverTitle = make('span', 'cover-title', book.title);
  cover.append(coverType, coverTitle, make('span', 'cover-decoration'));
  if (book.cover) {
    const image = make('img', 'cover-image');
    image.alt = '';
    image.loading = 'lazy';
    image.src = URL.createObjectURL(book.cover);
    coverUrls.push(image.src);
    image.addEventListener('error', () => image.remove(), { once: true });
    cover.append(image);
  }
  const title = make('strong', 'card-title', book.title);
  title.title = book.title;
  const details = make('span', 'card-details', book.author || book.chapterCount + ' 章');
  const percent = Math.round((book.progress?.fraction || 0) * 100);
  const progress = make('span', 'card-progress', book.progress ? '已读 ' + percent + '%' : '未开始');
  if (book.progress) {
    const line = make('progress');
    line.max = 100;
    line.value = percent;
    line.setAttribute('aria-label', '阅读进度');
    progress.prepend(line);
  }
  open.append(cover, title, details, progress);
  const more = make('button', 'icon-button card-menu');
  more.type = 'button';
  more.setAttribute('aria-label', '管理《' + book.title + '》');
  const slot = make('span');
  slot.dataset.icon = 'more';
  more.append(slot);
  addIcons(more);
  more.addEventListener('click', async () => {
    const result = await choose(book.title, '移出书架会清除这本书在当前浏览器里保存的正文、插图和阅读进度。', [
      ['取消', 'cancel', 'quiet'], ['移出书架', 'remove', 'danger']
    ]);
    if (result !== 'remove') return;
    try {
      await removeBook(await library, book.id);
      await refreshShelf();
      message('已移出书架。');
    } catch (error) {
      message('移出失败。' + formatError(error));
    }
  });
  card.append(open, more);
  return card;
}

function renderShelf() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const filtered = books.filter(book => (book.title + ' ' + book.author).toLocaleLowerCase().includes(query));
  const sort = $('sort').value;
  filtered.sort((a, b) => {
    if (sort === 'title') return alphabetic.compare(a.title, b.title);
    if (sort === 'recent') {
      const difference = (b.progress?.at || 0) - (a.progress?.at || 0);
      if (difference) return difference;
    }
    return b.addedAt - a.addedAt;
  });
  for (const url of coverUrls) URL.revokeObjectURL(url);
  coverUrls = [];
  grid.replaceChildren(...filtered.map(coverCard));
  $('book-count').textContent = books.length + ' 本';
  const noResults = !filtered.length;
  visible(grid, !noResults);
  visible($('empty'), noResults);
  if (noResults) {
    $('empty-title').textContent = query ? '没有找到相关小说' : '书架等着你的第一本小说';
    $('empty-message').textContent = query ? '试试其他书名或作者。' : '选择文件夹，或将小说和插图拖到这里。';
  }
}

async function refreshShelf() {
  books = await listBooks(await library);
  renderShelf();
}

function setImporting(value) {
  busy = value;
  $('pick-folder').disabled = value;
  $('pick-files').disabled = value;
  $('shelf').setAttribute('aria-busy', String(value));
}

async function importSelection(getFiles) {
  if (busy) return;
  setImporting(true);
  try {
    const files = await getFiles();
    if (!files.length) return;
    message('正在读取本地文件…', true);
    const { groups, warnings } = await collect(files);
    let imported = 0;
    let duplicates = 0;
    let skipped = 0;
    const db = await library;
    for (const group of groups) {
      let merge = false;
      const count = countTexts(group);
      if (count > 1) {
        visible($('toast'), false);
        const mode = await choose('这些文本怎么导入？',
          (group.label ? '「' + group.label + '」里' : '本次选择中') + '有 ' + count + ' 个 TXT 或 Markdown 文件。若它们是同一本小说的分章文件，可按文件名顺序合并。EPUB 始终单独导入。', [
            ['跳过', 'skip', 'quiet'], ['每个文件一本', 'individual', 'primary'], ['合并成一本', 'merge', 'quiet']
          ]);
        if (!mode || mode === 'skip') {
          skipped++;
          continue;
        }
        merge = mode === 'merge';
        message('正在保存到本地书库…', true);
      }
      for await (const result of readGroup(group, merge)) {
        if (result.warning) {
          warnings.push(result.warning);
          continue;
        }
        try {
          if (await saveBook(db, result.book)) imported++;
          else duplicates++;
        } catch (error) {
          warnings.push(result.book.title + '：' + formatError(error));
        }
      }
    }
    await refreshShelf();
    if (warnings.length) {
      visible($('toast'), false);
      const list = make('ul', 'warnings');
      for (const warning of warnings) list.append(make('li', '', warning));
      const summary = '已加入书架 ' + imported + ' 本' + (duplicates ? '，保留已有的 ' + duplicates + ' 本' : '') + '。';
      showDialog(imported || duplicates ? '部分文件未能导入' : '导入失败', [
        make('p', 'dialog-copy', summary), list
      ]);
    } else if (imported || duplicates) {
      message('已导入 ' + imported + ' 本' + (duplicates ? '，保留已有的 ' + duplicates + ' 本' : '') + '。');
    } else {
      message(skipped ? '没有新书加入书架。' : '没有找到可导入的 TXT、Markdown 或 EPUB 小说。');
    }
  } catch (error) {
    message('导入失败。' + formatError(error));
  } finally {
    setImporting(false);
  }
}

async function selectFiles(event) {
  const input = event.currentTarget;
  const files = [...input.files];
  if (!files.length) return;
  void navigator.storage?.persist?.().catch(() => {});
  try {
    await importSelection(() => files);
  } finally {
    input.value = '';
  }
}

function applyAppearance() {
  document.documentElement.dataset.theme = reader ? settings.theme : 'shelf';
  document.documentElement.dataset.size = String(settings.size);
  document.querySelector('meta[name="theme-color"]').content = reader && settings.theme === 'night' ? '#1c211d' : '#f6f4ed';
}

function saveAppearance() {
  try { localStorage.setItem('paper-shelf:appearance', JSON.stringify(settings)); } catch {}
}

function readerImage(path, alt = '') {
  const url = reader.urls.get(path);
  if (!url) return document.createDocumentFragment();
  const image = make('img', 'illustration');
  image.src = url;
  image.alt = alt;
  image.decoding = 'async';
  image.addEventListener('error', () => image.replaceWith(make('span', 'broken-image', '无法显示这张插图')), { once: true });
  return image;
}

function renderBlock(block) {
  if (typeof block === 'string') return document.createTextNode(block);
  if (block.image) {
    const figure = make('figure');
    figure.append(readerImage(block.image, block.alt));
    if (block.alt) figure.append(make('figcaption', '', block.alt));
    return figure;
  }
  const element = make(block.tag);
  for (const child of block.children) element.append(renderBlock(child));
  return element;
}

function scrollPosition() {
  const line = $('reader').querySelector('.reader-header').getBoundingClientRect().bottom + 8;
  const children = article.children;
  if (!children.length || window.scrollY < 12) return { block: -1, offset: 0 };
  let low = 0;
  let high = children.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (children[middle].getBoundingClientRect().bottom < line) low = middle + 1;
    else high = middle;
  }
  const box = children[low].getBoundingClientRect();
  return { block: low, offset: bound((line - box.top) / Math.max(1, box.height)) };
}

function readFraction(session) {
  const height = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const final = session.index === session.chapters.length - 1;
  const chapterFraction = height > 4 ? bound(window.scrollY / height) : (final ? 1 : 0);
  const start = session.offsets[session.index];
  return bound((start + session.chapters[session.index].length * chapterFraction) / session.offsets.at(-1));
}

function updateProgress(saveImmediately = false) {
  const session = reader;
  if (!session || session.restoring) return;
  const fraction = readFraction(session);
  $('reader-progress').value = Math.round(fraction * 100);
  clearTimeout(session.timeout);
  const persist = () => {
    if (reader !== session || session.restoring) return;
    const data = { id: session.book.id, index: session.index, ...scrollPosition(), fraction: readFraction(session), at: Date.now() };
    return saveProgress(session.db, data).catch(error => message('阅读进度保存失败。' + formatError(error)));
  };
  if (saveImmediately) return persist();
  session.timeout = setTimeout(persist, 180);
}

async function showChapter(index, position) {
  const session = reader;
  const renderId = ++session.renderId;
  clearTimeout(session.timeout);
  session.restoring = true;
  session.index = clamp(index, 0, session.chapters.length - 1);
  const section = session.chapters[session.index];
  $('chapter-title').textContent = section.title;
  $('reader-position').textContent = (session.index + 1) + ' / ' + session.chapters.length + ' 章';
  $('prev').disabled = session.index === 0;
  $('next').disabled = session.index === session.chapters.length - 1;
  const fragment = document.createDocumentFragment();
  for (const block of section.blocks) {
    if (typeof block !== 'string') fragment.append(renderBlock(block));
    else if (block.trim()) fragment.append(make('p', '', block));
  }
  article.replaceChildren(fragment);
  window.scrollTo(0, 0);
  if (position?.block >= 0 && article.children.length) {
    await Promise.race([
      Promise.allSettled([...article.querySelectorAll('img')].map(image => image.decode())),
      new Promise(resolve => window.setTimeout(resolve, 900))
    ]);
    if (reader !== session || session.renderId !== renderId) return;
    const target = article.children[Math.min(position.block, article.children.length - 1)];
    const line = $('reader').querySelector('.reader-header').getBoundingClientRect().bottom + 8;
    const box = target.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + box.top - line + box.height * bound(position.offset));
  }
  session.restoring = false;
  $('chapter-title').focus({ preventScroll: true });
  void updateProgress(true);
}

function jump(index) {
  if (!reader || index < 0 || index >= reader.chapters.length || index === reader.index) return;
  void showChapter(index);
}

function closeReader() {
  if (!reader) return;
  void updateProgress(true);
  for (const url of reader.urls.values()) URL.revokeObjectURL(url);
  reader = null;
  if (dialog.open) dialog.close();
  article.replaceChildren();
  applyAppearance();
  document.title = '纸间 · 私人小说书架';
  visible($('reader'), false);
  visible($('shelf-header'), true);
  visible($('shelf'), true);
  window.scrollTo(0, shelfScroll);
}

async function route() {
  const version = ++routeVersion;
  const id = history.state?.book;
  if (!id) {
    closeReader();
    await refreshShelf();
    return;
  }
  if (reader?.book.id === id) return;
  try {
    const db = await library;
    const data = await loadBook(db, id);
    if (version !== routeVersion) return;
    if (!data) {
      history.replaceState(null, '');
      closeReader();
      await refreshShelf();
      message('这本书已移出书架。');
      return;
    }
    closeReader();
    shelfScroll = window.scrollY;
    const { book, content, progress } = data;
    const offsets = [0];
    for (const section of content.chapters) offsets.push(offsets.at(-1) + section.length);
    reader = {
      db, book, offsets, chapters: content.chapters, assets: content.assets,
      urls: new Map(content.assets.map(asset => [asset.path, URL.createObjectURL(asset.blob)])),
      renderId: 0, index: 0, restoring: false
    };
    document.title = '阅读 · 纸间';
    $('reader-title').textContent = book.title;
    $('gallery').disabled = !content.assets.length;
    visible($('reader'), true);
    visible($('shelf-header'), false);
    visible($('shelf'), false);
    applyAppearance();
    void showChapter(progress?.index || 0, progress);
  } catch (error) {
    message('打开小说失败。' + formatError(error));
  }
}

function showContents() {
  if (!reader) return;
  const list = make('nav', 'toc-list');
  list.setAttribute('aria-label', '目录');
  let active;
  reader.chapters.forEach((section, index) => {
    const item = button(section.title);
    if (index === reader.index) {
      active = item;
      item.setAttribute('aria-current', 'page');
    }
    item.addEventListener('click', () => {
      dialog.close();
      jump(index);
    });
    list.append(item);
  });
  showDialog('目录', [list]);
  active?.scrollIntoView({ block: 'nearest' });
}

function showGallery() {
  if (!reader) return;
  const list = make('div', 'gallery-grid');
  for (const [index, asset] of reader.assets.entries()) {
    const name = asset.path.split('/').at(-1);
    const item = button('', 'thumbnail');
    item.setAttribute('aria-label', '查看插图 ' + name);
    const img = readerImage(asset.path, '');
    img.loading = 'lazy';
    item.append(img, make('span', '', name));
    item.addEventListener('click', () => showGalleryImage(index));
    list.append(item);
  }
  showDialog('插图', [list]);
}

function showGalleryImage(index) {
  const asset = reader.assets[index];
  const name = asset.path.split('/').at(-1);
  const nav = make('div', 'dialog-actions gallery-nav');
  for (const [label, step] of [['上一张', -1], ['全部插图', 0], ['下一张', 1]]) {
    const item = button(label);
    item.disabled = index + step < 0 || index + step >= reader.assets.length;
    item.addEventListener('click', () => step ? showGalleryImage(index + step) : showGallery());
    nav.append(item);
  }
  const picture = make('div', 'gallery-full');
  picture.append(readerImage(asset.path, name));
  showDialog(name, [picture, nav]);
}

function showSettings() {
  const themeList = make('div', 'settings-choices');
  const sizeList = make('div', 'settings-choices');
  const currentSize = make('output');
  const types = [['paper', '纸色'], ['plain', '浅色'], ['night', '夜间']];
  const resizeButtons = [-1, 1].map(step => {
    const control = button(step < 0 ? 'A−' : 'A+');
    control.setAttribute('aria-label', step < 0 ? '缩小字号' : '增大字号');
    control.addEventListener('click', () => {
      const anchor = scrollPosition();
      settings.size = clamp(settings.size + step, 0, 4);
      applyAppearance();
      saveAppearance();
      updateChoices();
      void showChapter(reader.index, anchor);
    });
    return control;
  });
  for (const [value, label] of types) {
    const control = button(label);
    control.dataset.value = value;
    control.addEventListener('click', () => {
      settings.theme = value;
      applyAppearance();
      saveAppearance();
      updateChoices();
    });
    themeList.append(control);
  }
  function updateChoices() {
    for (const item of themeList.children) item.setAttribute('aria-pressed', String(settings.theme === item.dataset.value));
    currentSize.textContent = [16, 19, 22, 26, 30][settings.size] + ' px';
    resizeButtons[0].disabled = settings.size === 0;
    resizeButtons[1].disabled = settings.size === 4;
  }
  sizeList.append(resizeButtons[0], currentSize, resizeButtons[1]);
  updateChoices();
  showDialog('阅读设置', [make('h3', 'setting-label', '背景'), themeList, make('h3', 'setting-label', '字号'), sizeList]);
}

addIcons(document);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
visible($('install'), !standalone);
$('install').addEventListener('click', installApp);
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  visible($('install'), false);
});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(error => {
      console.warn('纸间离线资源初始化失败。', error);
    });
  });
}
history.scrollRestoration = 'manual';
$('privacy').addEventListener('click', openPrivacy);
$('dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
$('pick-folder').addEventListener('click', () => {
  if ('webkitdirectory' in $('folder-input')) $('folder-input').click();
  else {
    message('当前浏览器的文件选择器不支持文件夹，请选择 ZIP 压缩包。');
    $('file-input').click();
  }
});
$('pick-files').addEventListener('click', () => $('file-input').click());
$('folder-input').addEventListener('change', selectFiles);
$('file-input').addEventListener('change', selectFiles);
$('search').addEventListener('input', renderShelf);
$('sort').addEventListener('change', renderShelf);
for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
  window.addEventListener(type, event => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    if (reader || busy || dialog.open) return;
    if (type === 'dragenter') dragDepth++;
    if (type === 'dragleave') dragDepth = Math.max(0, dragDepth - 1);
    if (type === 'drop') {
      dragDepth = 0;
      void navigator.storage?.persist?.().catch(() => {});
      void importSelection(() => droppedFiles(event.dataTransfer));
    }
    visible($('drop-overlay'), dragDepth > 0);
  });
}
const followRoute = () => route().catch(error => message('打开书库失败。' + formatError(error)));
window.addEventListener('popstate', followRoute);
window.addEventListener('scroll', () => updateProgress(), { passive: true });
window.addEventListener('pagehide', () => updateProgress(true));
document.addEventListener('visibilitychange', () => { if (document.hidden) void updateProgress(true); });
window.addEventListener('keydown', event => {
  if (!reader || dialog.open || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowLeft') jump(reader.index - 1);
  if (event.key === 'ArrowRight') jump(reader.index + 1);
});
$('back').addEventListener('click', () => {
  if (!history.state?.book) return;
  if (history.length > 1) history.back();
  else {
    history.replaceState(null, '');
    followRoute();
  }
});
$('toc').addEventListener('click', showContents);
$('gallery').addEventListener('click', showGallery);
$('settings').addEventListener('click', showSettings);
$('prev').addEventListener('click', () => jump(reader.index - 1));
$('next').addEventListener('click', () => jump(reader.index + 1));
applyAppearance();
void followRoute().finally(() => {
  if (books.length || $('book-count').textContent || reader) return;
  $('empty-title').textContent = '暂时无法打开书架';
  $('empty-message').textContent = '请检查浏览器是否允许此网站使用本地存储。';
});
