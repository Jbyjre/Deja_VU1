// The pane runs in a sealed frame: it can only ask Deja Vu1 for what its permissions allow, through dejavu.call.
const root = document.getElementById('root');

function row(name, head) {
  const temp = head.temperature == null ? 'no reading' : `${Math.round(head.temperature)} °C`;
  const target = head.target ? ` of ${Math.round(head.target)} °C` : '';
  const what = head.loaded ? head.material || head.colour_name || 'filament' : 'empty';
  const li = document.createElement('li');
  li.textContent = `${name}: ${temp}${target}, ${what}`;
  return li;
}

async function draw() {
  try {
    const s = await dejavu.call('printer.state');
    const list = document.createElement('ul');
    Object.keys(s.heads).forEach(name => list.appendChild(row(name, s.heads[name])));
    const head = document.createElement('p');
    head.textContent = `${s.printer}${s.practice ? ' (practice printer)' : ''}: ${s.state}`;
    root.replaceChildren(head, list);
  } catch (e) {
    root.textContent = e.message;
  }
}

draw();
setInterval(draw, 3000);
