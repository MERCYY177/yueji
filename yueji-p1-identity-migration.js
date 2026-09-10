(()=>{
  'use strict';

  const MIGRATION_KEY='yueji-identity-migrations-v1';

  function readMigrations(){
    try{return JSON.parse(localStorage.getItem(MIGRATION_KEY)||'[]')}catch{return []}
  }

  function saveMigrations(rows){
    localStorage.setItem(MIGRATION_KEY,JSON.stringify(rows));
  }

  function recordIdentityMigration(oldKey,newKey,source='weread'){
    if(!oldKey||!newKey||oldKey===newKey)return;
    const rows=readMigrations();
    if(rows.some(x=>x.oldKey===oldKey&&x.newKey===newKey))return;
    rows.push({
      oldKey:String(oldKey),
      newKey:String(newKey),
      source,
      status:'pending',
      createdAt:Date.now()
    });
    saveMigrations(rows);
  }

  async function atomicRemoveLegacyBook(db,stores,oldKey){
    const tx=db.transaction(stores,'readwrite');
    for(const name of stores){
      const store=tx.objectStore(name);
      if(store.keyPath==='key'||store.keyPath==='bookKey'){
        store.delete(oldKey);
      }
    }
    await new Promise((resolve,reject)=>{
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error);
    });
  }

  window.yuejiIdentityMigration={
    readMigrations,
    recordIdentityMigration,
    atomicRemoveLegacyBook
  };
})();
