/* MSFG inbox: the dashboard API authorizes every request; no AWS credentials in the browser. */
(() => {
  const list = document.getElementById('emailList');
  const content = document.getElementById('emailContent');
  const refresh = document.getElementById('refresh');
  const previous = document.getElementById('previous');
  const next = document.getElementById('next');
  const status = document.getElementById('inboxStatus');
  let offset = 0;
  let nextOffset = null;
  let selection = 0;

  function textElement(tag, text, className = '') {
    const node = document.createElement(tag);
    node.textContent = text;
    node.className = className;
    return node;
  }

  async function viewEmail(key) {
    const request = ++selection;
    content.replaceChildren(textElement('p', 'Loading email…', 'text-gray-500'));
    try {
      const email = await ServerAPI.request('/info-inbox/message?key=' + encodeURIComponent(key));
      if (request !== selection) return;
      const header = textElement('div', '', 'mb-4 border-b pb-3 text-sm space-y-1');
      header.append(textElement('h2', email.subject, 'font-bold text-lg mb-2'));
      header.append(textElement('p', 'From: ' + email.from));
      header.append(textElement('p', 'To: ' + email.to));
      if (email.date) header.append(textElement('p', new Date(email.date).toLocaleString(), 'text-gray-500'));
      if (email.archived) header.append(textElement('p', 'Archived text copy', 'text-gray-500'));
      content.replaceChildren(header);
      if (email.html) {
        const frame = document.createElement('iframe');
        frame.title = 'Email content';
        frame.setAttribute('sandbox', '');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.className = 'w-full border rounded bg-white';
        frame.style.minHeight = '550px';
        // No scripts, remote images, forms or same-origin access in email HTML.
        frame.srcdoc = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">' + email.html;
        content.append(frame);
      } else {
        content.append(textElement('div', email.text, 'whitespace-pre-wrap break-words bg-gray-50 p-4 rounded leading-relaxed'));
      }
    } catch (error) {
      if (request === selection) content.replaceChildren(textElement('p', error.message || 'Unable to load email.', 'text-red-700'));
    }
  }

  async function loadEmails(targetOffset = 0) {
    refresh.disabled = previous.disabled = next.disabled = true;
    status.textContent = 'Loading emails…';
    try {
      const data = await ServerAPI.request('/info-inbox?offset=' + targetOffset);
      offset = targetOffset;
      nextOffset = data.nextOffset;
      list.replaceChildren();
      data.items.forEach(email => {
        const li = document.createElement('li');
        const button = textElement('button', '', 'w-full text-left hover:bg-green-50 p-3');
        button.append(textElement('p', email.subject, 'font-semibold text-sm truncate text-gray-800'));
        button.append(textElement('p', 'From: ' + email.from, 'text-xs text-gray-600 truncate'));
        button.append(textElement('p', email.date ? new Date(email.date).toLocaleString() : new Date(email.lastModified).toLocaleString(), 'text-xs text-gray-500 mt-1'));
        button.addEventListener('click', () => viewEmail(email.key));
        li.append(button);
        list.append(li);
      });
      if (!data.items.length) list.append(textElement('li', 'No emails found.', 'p-4 text-gray-500'));
      status.textContent = data.total ? `${offset + 1}–${offset + data.items.length} of ${data.total} emails` : 'No emails yet';
    } catch (error) {
      status.textContent = error.message || 'Unable to load emails. Try Refresh.';
    } finally {
      refresh.disabled = false;
      previous.disabled = offset === 0;
      next.disabled = nextOffset === null;
    }
  }
  refresh.addEventListener('click', () => loadEmails(0));
  previous.addEventListener('click', () => loadEmails(Math.max(0, offset - 100)));
  next.addEventListener('click', () => loadEmails(nextOffset));
  loadEmails();
})();
