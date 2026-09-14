// Keep the failure UI independent of the application's module graph.
import('./app.js').catch(error=>{
 console.error(error);
 const host=document.querySelector('#app');host.replaceChildren();
 const panel=document.createElement('section');panel.className='boot-status';
 const title=document.createElement('h1');title.textContent='Knowledge Studio';
 const message=document.createElement('p');message.textContent='Не удалось запустить приложение. Локальные данные сохранены. '+error.message;
 const retry=document.createElement('button');retry.className='btn primary';retry.textContent='Повторить загрузку';retry.onclick=()=>location.reload();
 panel.append(title,message,retry);host.append(panel);
});
