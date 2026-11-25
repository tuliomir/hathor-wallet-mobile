/* @ds-bundle: {"format":4,"namespace":"E2EDash","components":[{"name":"StatusPill"},{"name":"ResultMark"},{"name":"TagChip"},{"name":"ScenarioId"},{"name":"TimeBar"},{"name":"Panel"},{"name":"NeedsYouCard"},{"name":"MessageCard"},{"name":"TimelineRow"}]} */
(function () {
  var h = window.React.createElement;
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(' '); }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'); }

  var STATE_LABEL = { starting: 'Starting', running: 'Running', paused: 'Paused', stuck: 'Stuck', finished: 'Finished', failed: 'Finished · failures', offline: 'Offline' };
  function StatusPill(p) {
    var s = p.state || 'running';
    return h('span', { className: cx('e2e-pill', 'e2e-pill--' + s), role: 'status' },
      h('span', { className: 'e2e-pill__dot', 'aria-hidden': 'true' }), p.label || STATE_LABEL[s] || s);
  }

  var RESULT = { passed: '✓', failed: '✕', running: '▶', queued: '○', 'did not run': '–', skipped: '⊘' };
  function ResultMark(p) {
    var r = p.result || 'queued';
    var retried = r === 'passed' && p.tries > 1;
    return h('span', { className: cx('e2e-result', 'e2e-result--' + slug(r)) },
      h('span', { className: 'e2e-result__g', 'aria-hidden': 'true' }, retried ? '↻' : (RESULT[r] || '•')),
      p.hideLabel ? null : r,
      retried ? h('span', { className: 'e2e-result__try', title: 'Passed on try ' + p.tries }, 'try ' + p.tries) : null);
  }

  function TagChip(p) {
    var legend = p.legend || {};
    var known = Object.prototype.hasOwnProperty.call(legend, p.tag);
    return h('span', { className: cx('e2e-tag', known ? null : 'e2e-tag--unknown'), title: legend[p.tag] || p.meaning || 'No legend for this tag yet' },
      p.count != null ? p.tag + ' ' + p.count : p.tag);
  }

  function ScenarioId(p) {
    var id = String(p.id || '');
    var title = id.indexOf(':') >= 0 ? id.slice(id.lastIndexOf(':') + 1) : id;
    var parts = title.split('.');
    var hl = p.highlight || [];
    var wallets = ['unlocked', 'locked', 'broken-key'];
    var out = [];
    parts.forEach(function (part, i) {
      if (i) out.push(h('span', { key: 'd' + i, className: 'e2e-sid__dot', 'aria-hidden': 'true' }, '.'));
      var cls = hl.indexOf(part) >= 0 ? 'e2e-sid__hl' : (i === parts.length - 1 && wallets.indexOf(part) >= 0 ? 'e2e-sid__wallet' : null);
      out.push(h('span', { key: 'p' + i, className: cls }, part));
    });
    return h('span', { className: 'e2e-sid', title: id }, out);
  }

  function fmt(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function TimeBar(p) {
    var ratio = p.expected ? p.elapsed / p.expected : 0;
    var over = ratio > 1;
    return h('div', { className: cx('e2e-timebar', over ? 'e2e-timebar--over' : null) },
      h('div', { className: 'e2e-timebar__track', role: 'img', 'aria-label': fmt(p.elapsed) + ' of ' + fmt(p.expected) + ' expected' },
        h('div', { className: 'e2e-timebar__fill', style: { width: Math.min(ratio / 1.5, 1) * 100 + '%' } }),
        h('div', { className: 'e2e-timebar__tick' })),
      h('div', { className: 'e2e-timebar__cap' },
        h('span', null, h('b', null, fmt(p.elapsed)), ' of ', fmt(p.expected), ' expected', over ? ' · ' + Math.round(ratio * 10) / 10 + '×' : ''),
        p.right ? h('span', null, p.right) : null));
  }

  function Panel(p) {
    return h('section', { className: cx('e2e-panel', p.className), 'aria-label': p.label, id: p.id },
      p.label ? h('div', { className: 'e2e-eyebrow' }, p.label) : null, p.children);
  }

  function NeedsYouCard(p) {
    if (!p.title) return h('div', { className: 'e2e-needs e2e-needs--none' }, p.next || 'Nothing needs you now.');
    return h('div', { className: 'e2e-needs', role: 'alert' },
      h('div', { className: 'e2e-needs__head' }, h('span', { 'aria-hidden': 'true' }, '!'), p.title),
      p.what ? h('div', null, p.what) : null,
      p.command ? h('div', { className: 'e2e-needs__cmd' }, h('code', null, p.command),
        h('button', { className: 'e2e-btn', type: 'button', onClick: function () { try { navigator.clipboard.writeText(p.command); } catch (e) {} } }, 'Copy')) : null);
  }

  var KIND = { why: 'Why', note: 'Note', finding: '◆ Finding', correction: '↺ Correction' };
  function MessageCard(p) {
    return h('article', { className: cx('e2e-msg', 'e2e-msg--' + (p.kind || 'note')) },
      h('div', { className: 'e2e-msg__head' }, h('span', { className: 'e2e-msg__kind' }, KIND[p.kind] || p.kind),
        h('span', null, p.at || '', p.target ? ' · ' : '', p.target ? h('a', { href: '#' + slug(p.target) }, p.target) : null)),
      h('p', null, p.text),
      p.link ? h('a', { href: p.link, target: '_blank', rel: 'noopener' }, p.link + ' ↗') : null);
  }

  function TimelineRow(p) {
    var k = p.scale || 1, st = p.status || 'queued';
    var glyph = { done: '✓', running: '▶', failed: '✕', queued: '○' }[st] || '○';
    return h('div', { className: 'e2e-tl' },
      h('div', { className: cx('e2e-tl__label', 'e2e-tl__label--' + st) }, h('span', { 'aria-hidden': 'true' }, glyph), p.id),
      h('div', { className: 'e2e-tl__track' },
        h('div', { className: cx('e2e-tl__est', p.guess ? 'e2e-tl__est--guess' : null), style: { left: p.estStart * k, width: p.estSeconds * k } }),
        p.actSeconds ? h('div', { className: cx('e2e-tl__act', 'e2e-tl__act--' + st), style: { left: p.actStart * k, width: p.actSeconds * k } }) : null,
        (p.setups || []).map(function (s, i) { return h('div', { key: i, className: 'e2e-tl__setup', style: { left: s.start * k, width: s.seconds * k } }); })),
      h('div', { className: 'e2e-tl__drift' }, p.drift || (p.guess ? 'guess' : '')));
  }

  window.E2EDash = { StatusPill: StatusPill, ResultMark: ResultMark, TagChip: TagChip, ScenarioId: ScenarioId, TimeBar: TimeBar, Panel: Panel, NeedsYouCard: NeedsYouCard, MessageCard: MessageCard, TimelineRow: TimelineRow };
})();
