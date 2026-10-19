// Approved direction: bulk image OCR, editable team proposals, explicit batch save.
(function () {
  let sources = [], reading = false, saving = false;
  const key = value => value.trim().normalize('NFKC').toLowerCase();
  function cleanup() { sources.forEach(s => URL.revokeObjectURL(s.url)); sources = []; }
  function error(message) { $('#roster-import-error').textContent = message; }
  function parse(text) {
    const groups = []; let lines = [];
    const flush = () => { if (lines.length) groups.push(lines); lines = []; };
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) { flush(); continue; }
      if (/^team\s*(?:name\s*)?[:：-]/i.test(line) && lines.length) flush();
      lines.push(line);
    }
    flush();
    return groups.map(lines => ({ name: lines[0].replace(/^team\s*(?:name\s*)?[:：-]\s*/i, ''), players: lines.slice(1).map(line => line.replace(/^(?:player\s*\d+\s*[:：-]\s*|\d+[.)]\s+|[•●]\s*)/i, '')) }));
  }
  function card(team = {name:'',players:[]}) {
    const node = document.createElement('section'); node.className = 'panel roster-import-card';
    node.innerHTML = `<div class="panel-head"><h3>Review team</h3><button type="button" data-remove>Remove</button></div><label>Team name<input data-name maxlength="70" required value="${esc(team.name)}"></label><label>Players · one per line<textarea data-players rows="5" placeholder="Four starters and an optional substitute" required>${esc(team.players.join('\n'))}</textarea></label>`;
    node.querySelector('[data-remove]').onclick = () => node.remove();
    $('#roster-import-teams').append(node);
  }
  window.openRosterImport = function () {
    cleanup();
    modal(`<div class="panel-head"><h2>Import team roster</h2><button type="button" id="roster-import-close">Close</button></div><p>Choose team posters or roster screenshots. Review every name and symbol before saving.</p><div class="dropzone"><label>Roster images<input id="roster-images" type="file" accept="image/png,image/jpeg,image/webp" multiple></label><p class="caption">Up to 12 images, 15 MB each. Images are read in your browser. Internet is needed to load OCR.</p></div><div class="actions"><button id="roster-read" type="button">Read images</button></div><p id="roster-import-status" role="status"></p><progress id="roster-import-progress" max="1" value="0" hidden></progress><div id="roster-import-sources"></div><div id="roster-import-review" hidden><h3>Check the generated list</h3><p>Each card needs a team name and 4–5 players. Remove unwanted cards or add a missing team. Existing teams are kept.</p><form id="roster-import-form"><div id="roster-import-teams"></div><div class="actions"><button type="button" id="roster-import-add">＋ Add review card</button><button class="primary" id="roster-import-save">Add reviewed teams</button></div></form></div><p id="roster-import-error" class="error" role="alert"></p>`);
    $('#modal').style.width = 'min(960px, 94vw)';
    $('#roster-import-close').onclick = () => { if (reading || saving) return; closeModal(); };
    $('#modal').addEventListener('close', cleanup, {once:true});
    $('#modal').oncancel = e => { if (reading || saving) e.preventDefault(); };
    $('#roster-read').onclick = read;
    $('#roster-import-add').onclick = () => card();
    $('#roster-import-form').onsubmit = commit;
  };
  async function read() {
    const files = Array.from($('#roster-images').files);
    if (!files.length) return error('Choose roster images first.');
    if (files.length > 12 || files.some(f => f.size > 15 * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(f.type))) return error('Choose up to 12 PNG, JPG or WebP images, each no larger than 15 MB.');
    if (!window.Tesseract) return error('OCR could not load. Check your internet connection and reload.');
    if ($('#roster-import-teams').children.length && !confirm('Replace the current import review with a new scan?')) return;
    cleanup(); error(''); reading = busy = true;
    const controls = ['#roster-read','#roster-images','#roster-import-close'];
    controls.forEach(s => $(s).disabled = true);
    $('#roster-import-review').hidden = true;
    $('#roster-import-teams').replaceChildren(); $('#roster-import-sources').replaceChildren();
    $('#roster-import-progress').hidden = false;
    let worker, index = 0, failures = 0;
    try {
      worker = await Tesseract.createWorker('eng', 1, {logger: m => {
        $('#roster-import-status').textContent = `Image ${index + 1}/${files.length} · ${m.status || 'Reading'}`;
        $('#roster-import-progress').value = (index + (m.progress || 0)) / files.length;
      }});
      await worker.setParameters({tessedit_pageseg_mode:'3', preserve_interword_spaces:'1'});
      for (index = 0; index < files.length; index++) {
        const file = files[index], source = {url:URL.createObjectURL(file)}; sources.push(source);
        const section = document.createElement('details'); section.className = 'panel'; section.open = true;
        section.innerHTML = `<summary>${esc(file.name)}</summary><img class="roster-import-preview" src="${source.url}" alt="Roster source"><label>Recognized text · correct the grouping<textarea rows="8" placeholder="Team name, then one player per line. Separate teams with a blank line."></textarea></label><p class="caption">Use one team name followed by its players. Separate teams with a blank line, then generate cards.</p><button type="button">Generate cards from this text</button>`;
        $('#roster-import-sources').append(section);
        const textarea = section.querySelector('textarea');
        section.querySelector('button').onclick = () => { if (reading || saving) return; source.cards?.forEach(n => n.remove()); source.cards = []; for (const team of parse(textarea.value)) { card(team); source.cards.push($('#roster-import-teams').lastElementChild); } };
        try {
          const {data} = await worker.recognize(source.url);
          textarea.value = data.text || '';
          source.cards = [];
          for (const team of parse(textarea.value)) { card(team); source.cards.push($('#roster-import-teams').lastElementChild); }
        } catch (e) { failures++; textarea.placeholder = 'Image could not be read. Enter team name and players here, then generate cards.'; }
      }
      $('#roster-import-status').textContent = `Reading finished${failures ? ` · ${failures} image(s) could not be read` : ''}. Check source text and all team cards; poster decorations may need removing.`;
      $('#roster-import-progress').value = 1;
    } catch (e) { error('OCR failed: ' + e.message + '. You can still add review cards manually.'); }
    finally {
      try { if (worker) await worker.terminate(); } catch {}
      reading = busy = false; controls.forEach(s => $(s).disabled = false);
      $('#roster-import-review').hidden = false;
    }
  }
  async function commit(event) {
    event.preventDefault(); if (reading || saving) return; error('');
    const nodes = Array.from(document.querySelectorAll('.roster-import-card'));
    if (!nodes.length) return error('Generate or add at least one team card.');
    const names = new Set(state.teams.map(t => key(t.name))), teams = [];
    for (const [i, node] of nodes.entries()) {
      const name = node.querySelector('[data-name]').value.trim();
      const players = node.querySelector('[data-players]').value.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
      if (!name || name.length > 70 || players.length < 4 || players.length > 5 || players.some(p => p.length > 90) || new Set(players.map(key)).size !== players.length) return error(`Card ${i+1}: enter a team name and 4–5 distinct players (up to 90 characters each).`);
      if (names.has(key(name))) return error(`Card ${i+1}: "${name}" already exists in the roster or this import. Rename or remove that card.`);
      names.add(key(name)); teams.push({id:uid(),name,players:players.map(name => ({id:uid(),name}))});
    }
    saving = busy = true;
    $('#roster-import-save').disabled = true; $('#roster-import-close').disabled = true;
    const prior = structuredClone(state); state.teams.push(...teams);
    try { await save(); closeModal(); render(); toast(`${teams.length} teams added to the roster`); }
    catch (e) { state = prior; error(e.message); }
    finally { saving = busy = false; if ($('#roster-import-save')) $('#roster-import-save').disabled = false; if ($('#roster-import-close')) $('#roster-import-close').disabled = false; }
  }
})();
