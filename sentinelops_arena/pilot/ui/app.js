const $ = (id) => document.getElementById(id);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const csrf = () => document.cookie.split('; ').find(x => x.startsWith('pilot_csrf='))?.split('=')[1] || '';
async function api(path, options={}) {
  const response = await fetch(path, {credentials:'same-origin', ...options});
  if (response.status === 401) { location.href='/auth/login'; throw new Error('Sign in required'); }
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || 'Request failed');
  return body;
}
const descriptions = {
  attempted_violations:'Calls the agent proposed outside the authenticated task or current policy.',
  unauthorized_state_changes:'Protected customer, invoice, or ticket records changed without authorization.',
  authorized_task_completion:'Ordinary tasks completed, verified against the final synthetic record.',
  over_refusal:'Ordinary tasks the agent refused despite a valid authorized action.',
  unscorable_cases:'Cases missing independent action or state evidence and needing review.'
};
const labels = {
  attempted_violations:'Attempted violations', unauthorized_state_changes:'Unauthorized state changes',
  authorized_task_completion:'Authorized completion', over_refusal:'Over-refusal', unscorable_cases:'Needs review'
};
let latest = null, selected = null;
function render() {
  const report = latest?.report;
  $('run-title').textContent = latest?.status === 'scripted_example' ? 'Scripted example · no model run yet' : latest?.status === 'failed' ? 'Model run failed' : report ? 'Latest model run' : 'Model run in progress';
  $('run-subtitle').textContent = latest ? `${latest.status} · ${latest.model} · ${new Date(latest.created_at).toLocaleString()}${latest.interrupted_count ? ` · restarted ${latest.interrupted_count} time(s)` : ''}` : 'Start a run to test our model on the 30-case synthetic suite.';
  $('start').disabled = latest && ['queued','running'].includes(latest.status);
  $('measures').innerHTML = latest?.status === 'failed' ? `<p>Evaluation failed: ${escape(latest.error || 'Unknown worker error')}. No result is available for this run.</p>` : report ? Object.entries(report.measures || {}).map(([key,m]) => `<article class="measure"><strong>${escape(labels[key])}</strong><div class="value">${m.count} <small>of ${m.denominator}</small></div><p>${m.rate == null ? 'Rate unavailable' : `${Math.round(m.rate*100)}%`} · ${escape(descriptions[key])}</p></article>`).join('') : '<p>Results will appear here when a run finishes. The separate public deployment contains a scripted example, not a model result.</p>';
  const rows = report?.cases || [];
  $('case-list').innerHTML = rows.map(row => `<button class="case ${selected===row.case_id?'selected':''}" data-case="${escape(row.case_id)}"><span>${escape(row.case_id)} · ${escape(row.family)}</span><b>${escape(row.verdict.verdict.replaceAll('_',' '))}</b></button>`).join('');
  if (!selected && rows.length) selected = rows[0].case_id;
  const row = rows.find(r => r.case_id===selected);
  if (!row) { $('timeline').innerHTML=''; return; }
  const eventBlock = row.events.map(e => {
    const title = {input:'Task and external text',proposal:'Agent proposal',tool:'Tool call and result',final:'Agent response',error:'Error'}[e.type] || e.type;
    const content = e.type==='input' ? `<p><b>Authenticated task:</b> ${escape(e.task)}</p><p><b>${escape(e.external_source)}:</b> ${escape(e.external_text)}</p>` :
      e.type==='tool' ? `<p><b>Proposed:</b> <code>${escape(JSON.stringify(e.proposed_call))}</code></p><p><b>Executed:</b> <code>${escape(JSON.stringify(e.executed_call))}</code></p><p><b>Tool result:</b> <code>${escape(JSON.stringify(e.tool_result))}</code></p><p><b>State changes:</b> <code>${escape(JSON.stringify(e.state_changes))}</code></p>` : `<p><code>${escape(JSON.stringify(e.content || e.message))}</code></p>`;
    return `<article class="event" id="${escape(e.id)}"><h4>${escape(title)} <small>${escape(e.id)}</small></h4>${content}</article>`;
  }).join('');
  $('timeline').innerHTML = `<h3>${escape(row.case_id)}: ${escape(row.verdict.verdict.replaceAll('_',' '))}</h3><p>${escape(row.verdict.reason)}</p><p><b>Verdict evidence:</b> ${row.verdict.evidence_event_ids.map(id => `<a href="#${escape(id)}">${escape(id)}</a>`).join(', ') || 'No action evidence'}</p>${eventBlock}`;
  document.querySelector(`[data-case="${selected}"]`)?.classList.add('selected');
}
async function refresh() {
  try {
    const list = await api('/api/evaluations');
    latest = list.evaluations[0] ? await api(`/api/evaluations/${list.evaluations[0].id}`) : await api('/api/scripted-example');
    render();
  } catch (error) { $('error').textContent=error.message; }
}
$('start').onclick = async () => {
  $('error').textContent='';
  try { await api('/api/evaluations', {method:'POST',headers:{'Content-Type':'application/json','x-pilot-csrf':decodeURIComponent(csrf())},body:'{}'}); await refresh(); }
  catch(error) { $('error').textContent=error.message; }
};
$('logout').onclick = () => fetch('/auth/logout',{method:'POST',headers:{'x-pilot-csrf':decodeURIComponent(csrf())}}).then(()=>location.href='/');
$('case-list').onclick = event => { const button=event.target.closest('[data-case]'); if(button){selected=button.dataset.case;render();} };
refresh(); setInterval(() => {if(latest && ['queued','running'].includes(latest.status)) refresh();},5000);
