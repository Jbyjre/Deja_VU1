(async()=>{
 const query=new URLSearchParams(location.search),cards=await(await fetch('campaign.json')).json();
 const card=cards.find(c=>c.id===(query.get('id')||'01-fleet'));
 if(!card)throw new Error('Unknown campaign card');
 document.getElementById('poster').dataset.design=card.design;
 for(const key of ['eyebrow','body','evidence','limit','cta','destination','annotation'])document.getElementById(key).textContent=card[key]||'';
 document.getElementById('cta').insertAdjacentHTML('beforeend','<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20 20 4M4 4h16v16"/></svg>');
 const title=document.getElementById('title');
 for(const [i,line] of card.lines.entries()){const span=document.createElement('span');span.textContent=line;if(i===card.lines.length-1)span.className='accent';title.append(span);}
 document.getElementById('big-index').textContent=card.design==='connect'?'U1':card.id.slice(0,2);
 document.getElementById('detail-tag').textContent=card.detail;
 const img=document.getElementById('image');img.src=card.image;img.alt=card.alt;
 await img.decode();
 if(card.design==='fleet'){const art=new Image();art.src='img/brand-loop.png';await art.decode();}
 await document.fonts.ready;
 window.cardReady=true;
})().catch(e=>{window.cardError=e.message;throw e;});
