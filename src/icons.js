const paths = {
  book: '<path d="M12 7c-3-2-6-2.5-10-2v14c4-.5 7 0 10 2 3-2 6-2.5 10-2V5c-4-.5-7 0-10 2Zm0 0v14"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4m-4 4v2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 10v6m-3-3h6"/>',
  file: '<path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Zm0 0v7h7M8 14h8m-8 3h6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  sort: '<path d="M8 6h12M8 12h9m-9 6h6M4 4v15m-2-2 2 2 2-2"/>',
  shield: '<path d="M12 22s7-3.5 7-9V5l-7-3-7 3v8c0 5.5 7 9 7 9Z"/><path d="m9 12 2 2 4-4"/>',
  'arrow-left': '<path d="m11 5-7 7 7 7m-7-7h16"/>',
  'arrow-right': '<path d="m13 5 7 7-7 7m7-7H4"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m4 17 4-4 3 3 4-5 5 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
};

export function addIcons(root) {
  for (const slot of root.querySelectorAll('[data-icon]')) {
    slot.setAttribute('aria-hidden', 'true');
    slot.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' + paths[slot.dataset.icon] + '</svg>';
  }
}
