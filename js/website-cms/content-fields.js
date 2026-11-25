/* Structured public content fields. No HTML is accepted or rendered. */
(function () {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const labels = { intro: 'Introduction', 'service-cards': 'Mortgage family cards', 'program-cards': 'Program cards', benefits: 'Benefits', process: 'Process steps', 'officer-introduction': 'Loan officers', testimonials: 'Testimonials', faq: 'Frequently asked questions', disclosure: 'Disclosure', 'estimator-reference': 'Estimator introduction', cta: 'Call to action', 'legal-prose': 'Legal content' };
  function create(host, kind, source, options = {}) {
    const draft = clone(source);
    const photoAssets = [...new Set(options.photoAssets || [])];
    const refreshOfficerChoices = [];
    host.replaceChildren();
    const changed = () => host.dispatchEvent(new Event('input', { bubbles: true }));
    function field(parent, labelText, id, object, key, settings = {}) {
      const wrapper = make('div', undefined, 'cms-field');
      const label = make('label', labelText); label.htmlFor = id;
      let input;
      if (settings.choices) {
        input = make('select');
        for (const choice of settings.choices) {
          const option = make('option', choice.label ?? choice); option.value = choice.value ?? choice; input.append(option);
        }
      } else input = make(settings.multiline ? 'textarea' : 'input');
      input.id = id;
      if (settings.multiline) input.rows = settings.rows || 3;
      if (!settings.choices) { input.maxLength = settings.maxLength || 10000; if (!settings.multiline) input.type = settings.type || 'text'; }
      input.required = !settings.optional;
      input.value = settings.lines ? (object[key] || []).join('\n') : (object[key] ?? '');
      if (settings.pattern) input.pattern = settings.pattern;
      input.addEventListener('input', update); input.addEventListener('change', update);
      function update() {
        if (settings.lines) object[key] = input.value.split('\n').map(value => value.trim()).filter(Boolean);
        else if (settings.optional && !input.value) delete object[key];
        else object[key] = input.value;
      }
      wrapper.append(label, input); parent.append(wrapper);
      return input;
    }
    function link(parent, title, id, object, key, optional = false) {
      if (!object[key] && optional) return; // Existing optional links are retained; no implicit new action.
      const area = make('div', undefined, 'content-link-fields');
      area.append(make('h5', title));
      field(area, `${title} label`, `${id}-label`, object[key], 'label');
      field(area, `${title} destination`, `${id}-href`, object[key], 'href', { maxLength: 2048 });
      parent.append(area);
    }
    function controls(parent, items, index, redraw, minimum) {
      const actions = make('div', undefined, 'content-item-actions');
      for (const [text, enabled, run] of [
        ['Move up', index > 0, () => { [items[index - 1], items[index]] = [items[index], items[index - 1]]; }],
        ['Move down', index < items.length - 1, () => { [items[index + 1], items[index]] = [items[index], items[index + 1]]; }],
        ['Remove', items.length > minimum, () => { items.splice(index, 1); }],
      ]) {
        const button = make('button', text, 'button secondary'); button.type = 'button'; button.disabled = !enabled;
        button.addEventListener('click', () => { run(); redraw(); changed(); }); actions.append(button);
      }
      parent.append(actions);
    }
    function repeat(parent, label, items, id, minimum, maximum, fresh, itemFields, editable = true) {
      const region = make('div', undefined, 'content-repeater'); parent.append(region);
      function draw() {
        region.replaceChildren();
        items.forEach((item, i) => {
          const card = make('fieldset', undefined, 'content-item'); card.append(make('legend', `${label} ${i + 1}`));
          itemFields(card, item, `${id}-${i}`, i);
          if (editable) controls(card, items, i, draw, minimum);
          region.append(card);
        });
        if (editable && items.length < maximum) {
          const add = make('button', `Add ${label.toLowerCase()}`, 'button secondary'); add.type = 'button';
          add.addEventListener('click', () => { items.push(fresh()); draw(); changed(); region.querySelector('fieldset:last-of-type input, fieldset:last-of-type textarea')?.focus(); });
          region.append(add);
        }
      }
      draw();
    }
    function inline(parent, nodes, id) {
      nodes.forEach((node, i) => {
        const style = { text: 'Text', strong: 'Bold text', emphasis: 'Emphasized text', link: 'Link text' }[node.type];
        field(parent, `${style}${nodes.length > 1 ? ` ${i + 1}` : ''}`, `${id}-${i}-text`, node, 'text', { multiline: true });
        if (node.type === 'link') field(parent, 'Link destination', `${id}-${i}-href`, node, 'href', { maxLength: 2048 });
      });
    }
    function prose(parent, blocks, id, maximum = 30) {
      repeat(parent, 'Paragraph or list', blocks, id, 1, maximum, () => ({ type: 'paragraph', content: [{ type: 'text', text: '' }] }), (area, block, blockId) => {
        area.append(make('p', block.type === 'list' ? (block.ordered ? 'Numbered list' : 'Bulleted list') : block.type === 'heading' ? 'Subheading' : 'Paragraph', 'muted'));
        if (block.type === 'list') repeat(area, 'List item', block.items, `${blockId}-item`, 1, 100, () => [{ type: 'text', text: '' }], (listArea, nodes, itemId) => inline(listArea, nodes, itemId));
        else inline(area, block.content, blockId);
      });
    }
    function cardFields(area, card, id) {
      field(area, 'Card title', `${id}-title`, card, 'title');
      field(area, 'Card subtitle', `${id}-subtitle`, card, 'subtitle', { optional: true });
      field(area, 'Card description', `${id}-description`, card, 'description', { multiline: true });
      link(area, 'Card link', `${id}-link`, card, 'link');
      if (card.imageAsset) {
        const images = [...new Set([card.imageAsset, ...photoAssets])];
        field(area, 'Card image', `${id}-image`, card, 'imageAsset', { choices: images });
      }
    }
    if (kind === 'site') {
      host.append(make('h3', 'Company contact details'), make('p', 'These details appear wherever the published website uses company contact information.', 'muted'));
      for (const [key, label, type] of [['phoneDisplay','Phone number','text'],['phoneHref','Phone link (tel:+ country code and number)','text'],['email','Contact email','email'],['nmls','Company NMLS','text'],['nmlsConsumerAccessUrl','NMLS consumer access URL','url']]) field(host, label, `site-${key}`, draft.contact, key, { type });
      field(host, 'Office address', 'site-address', draft.legal, 'address', { multiline: true });
    } else if (kind === 'officer') {
      for (const [key,label,type] of [['name','Officer name','text'],['nmls','Officer NMLS','text'],['phone','Officer phone','text'],['email','Officer email','email']]) field(host,label,`officer-${key}`,draft,key,{type});
      field(host,'Biography','officer-biography',draft,'biography',{multiline:true,rows:7});
      field(host,'Specialties (one per line)','officer-specialties',draft,'specialties',{multiline:true,lines:true,optional:true});
      field(host,'Licensed states (two-letter codes, one per line)','officer-states',draft,'licensedStates',{multiline:true,lines:true});
      field(host,'Profile photo','officer-photo',draft,'photoAsset',{choices:[...new Set([draft.photoAsset,...photoAssets])]});
      host.append(make('p', 'Profile identity and URL are retained. Confirm licensing information before publishing.', 'muted'));
    } else {
      draft.sections.forEach((section, index) => {
        const details = make('details', undefined, 'content-section'); details.open = true;
        details.append(make('summary', `${index + 1} · ${labels[section.type] || section.type}`));
        host.append(details); const id = `section-${index}`;
        if ('heading' in section) field(details, `Section heading: ${section.type}`, `${id}-heading`, section, 'heading');
        if ('description' in section) field(details, 'Section description', `${id}-description`, section, 'description', { multiline: true });
        if ('body' in section) prose(details, section.body, `${id}-body`, section.type === 'legal-prose' ? 200 : section.type === 'intro' ? 50 : 30);
        if (section.type === 'legal-prose') field(details,'Effective date',`${id}-date`,section,'effectiveDate',{type:'date'});
        if (section.type === 'service-cards' || section.type === 'program-cards') repeat(details, 'Card', section.cards, `${id}-card`, section.type === 'service-cards' ? 5 : 1, section.type === 'service-cards' ? 5 : 30, () => ({ title:'',description:'',link:{label:'',href:''} }), cardFields, section.type !== 'service-cards');
        if (section.type === 'benefits' || section.type === 'process') repeat(details, section.type === 'process' ? 'Step' : 'Benefit', section.steps || section.items, `${id}-item`, 1, 20, () => ({ title:'',description:'' }), (area,item,itemId) => { field(area,'Title',`${itemId}-title`,item,'title');field(area,'Description',`${itemId}-description`,item,'description',{multiline:true}); });
        if (section.type === 'faq') repeat(details,'Question',section.items,`${id}-faq`,1,50,() => ({question:'',answer:[{type:'paragraph',content:[{type:'text',text:''}]}]}),(area,item,itemId) => {field(area,'Question',`${itemId}-question`,item,'question');prose(area,item.answer,`${itemId}-answer`);});
        if (section.type === 'officer-introduction') {
          link(details,'Directory link',`${id}-link`,section,'link');
          details.append(make('p','Featured officers use published profiles. Profile edits are saved and published separately.','muted'));
          const choices = make('div', undefined, 'featured-officer-choices'); details.append(choices);
          function renderOfficerChoices() {
            choices.replaceChildren();
            const available = (options.entities || []).filter(item => item.kind === 'officer' && item.publishedRevisionId);
            for (const officer of available) {
              const label = make('label',undefined,'checkbox-label'); const input=make('input'); input.type='checkbox';input.checked=section.officerIds.includes(officer.id);input.id=`${id}-officer-${officer.id}`;
              input.addEventListener('change',()=>{section.officerIds=input.checked?[...new Set([...section.officerIds,officer.id])]:section.officerIds.filter(value=>value!==officer.id);});
              label.append(input,document.createTextNode(officer.title));choices.append(label);
            }
          }
          refreshOfficerChoices.push(renderOfficerChoices); renderOfficerChoices();
        }
        if (section.type === 'testimonials') details.append(make('p', `${section.testimonialIds.length} approved testimonial references are retained.`, 'muted'));
        if (section.type === 'estimator-reference') field(details,'Estimator disclosure',`${id}-disclosure`,section,'disclosure',{multiline:true});
        if (section.type === 'cta') {link(details,'Primary button',`${id}-primary`,section,'primary');link(details,'Secondary button',`${id}-secondary`,section,'secondary',true);}
      });
    }
    return { read: () => clone(draft), updateEntities(entities) { options.entities = entities; refreshOfficerChoices.forEach(render => render()); } };
  }
  function preview(parent, kind, content) {
    function inline(area, nodes) {
      for (const item of nodes) {
        const tag = {text:'span',strong:'strong',emphasis:'em',link:'span'}[item.type];
        const node=make(tag,item.text);area.append(node);
        if(item.type==='link')area.append(make('small',` (${item.href})`,'preview-destination'));
      }
    }
    function prose(area, blocks) {
      for(const block of blocks){
        const node=make(block.type==='list'?(block.ordered?'ol':'ul'):block.type==='heading'?'h4':'p');
        if(block.type==='list')for(const item of block.items){const li=make('li');inline(li,item);node.append(li);}
        else inline(node,block.content);
        area.append(node);
      }
    }
    function link(area, item) { if(item)area.append(make('p',`${item.label} → ${item.href}`,'preview-destination')); }
    if(kind==='site'){
      parent.append(make('h3',content.company.shortName));
      for(const key of ['phoneDisplay','phoneHref','email','nmls','nmlsConsumerAccessUrl'])parent.append(make('p',`${{phoneDisplay:'Phone',phoneHref:'Phone link',email:'Email',nmls:'NMLS',nmlsConsumerAccessUrl:'NMLS link'}[key]}: ${content.contact[key]}`));
      parent.append(make('p',content.legal.address));return;
    }
    if(kind==='officer'){
      parent.append(make('h3',content.name),make('p',`NMLS ${content.nmls}`),make('p',content.phone),make('p',content.email),make('p',content.biography),make('p',`Specialties: ${content.specialties.join(', ')}`),make('p',`Licensed states: ${content.licensedStates.join(', ')}`),make('p',`Photo: ${content.photoAsset}`));return;
    }
    for(const section of content.sections){
      const area=make('section',undefined,'content-preview-section');parent.append(area);
      area.append(make('h3',section.heading||labels[section.type]));
      if(section.description)area.append(make('p',section.description));
      if(section.body)prose(area,section.body);
      if(section.effectiveDate)area.append(make('p',`Effective ${section.effectiveDate}`));
      for(const item of section.cards||section.steps||section.items||[]){
        area.append(make('h4',item.title||item.question));if(item.subtitle)area.append(make('p',item.subtitle));if(item.description)area.append(make('p',item.description));if(item.answer)prose(area,item.answer);if(item.imageAsset)area.append(make('p',`Image: ${item.imageAsset}`));link(area,item.link);
      }
      link(area,section.link);link(area,section.primary);link(area,section.secondary);
      if(section.disclosure)area.append(make('p',section.disclosure));
      if(section.officerIds)area.append(make('p',`Featured profile references: ${section.officerIds.join(', ')||'None'}`));
      if(section.testimonialIds)area.append(make('p',`Testimonial references: ${section.testimonialIds.join(', ')||'None'}`));
    }
  }
  window.WebsiteContentFields={create,preview};
})();
