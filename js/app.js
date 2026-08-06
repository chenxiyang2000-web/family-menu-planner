import { loadLocal, syncCloudState, save, uid, createPlan, categories, meals, healthTags, ingredientTags, cuisineOptions, servingOptions } from './storage.js';
import { currentPlan, dayIndexes, getSlot, slotKey, dishOf, eligible, buildSelectedPlan, completeExistingMenu, menuPreferenceOptions, replaceDish, shoppingSummary } from './logic.js?v=20260807-2';

let state=loadLocal(), view='library', filter='全部', search='', orderSelection=[], orderTarget=null, startFolderId=null, startPlanOpen=false;
let cloudBootstrapping=true,cloudStartupError='';
const cleanLegacyBlanks=targetState=>{
  let changed=false;
  targetState.plans.forEach(plan=>Object.keys(plan.slots||{}).forEach(key=>{
    const cleaned=(plan.slots[key]||[]).filter(item=>!item.blank);
    if(cleaned.length!==(plan.slots[key]||[]).length){plan.slots[key]=cleaned;changed=true}
  }));
  return changed;
};
let removedLegacyBlanks=cleanLegacyBlanks(state);
const displayCategories=['全部','肉类','蔬菜','主食','甜品','超大菜','其他'];
let allPages=Object.fromEntries(displayCategories.map(x=>[x,1])), orderCategory='全部', orderPages=Object.fromEntries(displayCategories.map(x=>[x,1])), listFolderId=null, listMenuIds=new Set(), startHistory=[];
let folderCreateOpen=false,menuCreateOpen=false,searchTimer=null;
let draggedMenuItem=null;
let operationBusy=false;
const imageRatios={
  allCard:{width:3,height:2,outputWidth:600,outputHeight:400},
  menuPreview:{width:1,height:1},
  detail:{width:4,height:5}
};
document.documentElement.style.setProperty('--all-card-image-ratio',`${imageRatios.allCard.width}/${imageRatios.allCard.height}`);
document.documentElement.style.setProperty('--menu-preview-image-ratio',`${imageRatios.menuPreview.width}/${imageRatios.menuPreview.height}`);
const app=document.querySelector('#app'), dishDialog=document.querySelector('#dish-dialog'), slotDialog=document.querySelector('#slot-dialog');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let appDishSource=null,appDishIndex=new Map();
const dish=id=>{
  if(appDishSource!==state.dishes){appDishSource=state.dishes;appDishIndex=new Map(state.dishes.map(item=>[item.id,item]))}
  return appDishIndex.get(id);
};
const plan=()=>currentPlan(state);
const showToast=(message,type='success')=>{
  let region=document.querySelector('#toast-region');
  if(!region){region=document.createElement('div');region.id='toast-region';region.setAttribute('aria-live','polite');document.body.append(region)}
  const toast=document.createElement('div');toast.className=`toast ${type}`;toast.textContent=message;region.append(toast);
  requestAnimationFrame(()=>toast.classList.add('show'));
  setTimeout(()=>{toast.classList.remove('show');setTimeout(()=>toast.remove(),180)},2200);
};
window.addEventListener('family-menu-cloud-status',event=>{
  if(event.detail?.status==='error'){
    showToast(event.detail.message||'云端同步失败，修改已暂存在本机。','error');
  }
});
const persist=(message='')=>{if(!save(state)){showToast('保存失败：本地存储空间不足，请删除过大的图片后重试。','error');return false}render();if(message)showToast(message);return true};
const nextPaint=()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
async function runBusy(button,label,task){
  if(operationBusy)return;
  operationBusy=true;
  const oldText=button?.textContent;
  if(button){button.disabled=true;button.textContent=label}
  try{await nextPaint();await task()}
  catch(error){console.error(error);showToast(error.message||'操作失败，请重试。','error')}
  finally{operationBusy=false;if(button?.isConnected){button.disabled=false;button.textContent=oldText}}
}
const checks=(name,options,selected,suffix='',type='checkbox')=>options.map(x=>`<label><input type="${type}" name="${name}" value="${x}" ${selected.includes(x)?'checked':''}> ${x}${suffix}</label>`).join('');
const spicyStars=level=>`${'★'.repeat(Math.max(0,Math.min(5,Number(level)||0)))}${'☆'.repeat(5-Math.max(0,Math.min(5,Number(level)||0)))}`;
const spicyChoices=(name,selected)=>{
  const value=Math.max(0,Math.min(5,Number(selected)||0));
  return `<div class="star-picker" data-name="${name}" data-value="${value}" role="group" aria-label="辣度星级">${[1,2,3,4,5].map(level=>`<button type="button" data-action="set-spicy" data-level="${level}" class="${level<=value?'selected':''}" aria-label="${level} 星" aria-pressed="${level<=value}">${level<=value?'★':'☆'}</button>`).join('')}</div>`;
};
const header=(title,subtitle,actions='')=>`<section class="page-head"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="actions">${actions}</div></section>`;
const dateFor=(date,offset)=>{const d=new Date(`${date}T00:00:00`);d.setDate(d.getDate()+offset);return d.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})};
const categoryIcon=category=>category==='肉菜'?'🥩':category==='蔬菜'?'🥬':category==='主食'?'🍚':category==='甜品'?'🍰':category==='超大菜'?'🍲':'⭐';
const displayCategory=dish=>dish.category==='肉菜'?'肉类':dish.category==='蔬菜'?'蔬菜':dish.category==='主食'?'主食':dish.category==='甜品'?'甜品':dish.category==='超大菜'?'超大菜':'其他';
const matchesGeneratedCategory=(dish,category)=>category==='其他'
  ? !['肉菜','蔬菜','主食','甜品','超大菜'].includes(dish.category)
  : dish.category===category;
const categoryRank=category=>category==='肉菜'?0:category==='蔬菜'?1:category==='主食'?2:category==='甜品'?3:4;
const pageSlice=(items,page)=>({items:items.slice((page-1)*20,page*20),pages:Math.max(1,Math.ceil(items.length/20))});
const pagination=(page,pages,scope)=>pages<=1?'':`<div class="pagination"><button data-action="page-prev" data-scope="${scope}" ${page<=1?'disabled':''}>‹</button>${Array.from({length:pages},(_,i)=>`<button data-action="page-set" data-scope="${scope}" data-page="${i+1}" class="${page===i+1?'active':''}">${i+1}</button>`).join('')}<button data-action="page-next" data-scope="${scope}" ${page>=pages?'disabled':''}>›</button></div>`;
const backButton=()=>'<button class="btn secondary" data-action="start-back">← 返回上一步</button>';
function rememberStart(){startHistory.push({startFolderId,startPlanOpen,folderCreateOpen,menuCreateOpen,view})}

function libraryCard(d){
  const image=d.image?`style="background-image:url('${d.image}')"`:'';
  return `<article class="dish-card"><div class="dish-image" ${image}>${d.image?'':esc(d.name.slice(0,1))}</div>
  <button class="favorite" data-action="favorite" data-id="${d.id}">${d.favorite?'♥':'♡'}</button>
  <div class="dish-body"><h2 class="dish-title">${esc(d.name)}</h2><div class="meta">${d.category} · ¥${Number(d.price||0).toFixed(2)}</div>
  <div class="tags">${[...(d.tags||[]),...(d.healthTags||[])].map(t=>`<span class="tag">${t}</span>`).join('')}</div>
  <div class="meta">食材：${esc(d.ingredients.join('、'))}</div></div>
  <div class="dish-foot"><span><button class="text-btn" data-action="view-dish" data-id="${d.id}">查看详情</button><button class="text-btn" data-action="edit-dish" data-id="${d.id}">编辑</button></span><button class="text-btn" data-action="delete-dish" data-id="${d.id}">删除</button></div></article>`;
}
function libraryView(){
  const query=search.toLowerCase();
  const shown=state.dishes.filter(d=>(filter==='全部'||displayCategory(d)===filter)&&
    `${d.name} ${d.ingredients.join(' ')} ${(d.tags||[]).join(' ')} ${(d.healthTags||[]).join(' ')}`.toLowerCase().includes(query));
  let page=allPages[filter]||1;const paged=pageSlice(shown,page);if(page>paged.pages){page=paged.pages;allPages[filter]=page}
  return `${header('ALL','按肉类、蔬菜、主食、甜品、超大菜和其他分类；每类每页最多 20 道。',`<button class="btn secondary" data-action="export-dishes">导出</button><button class="btn" data-action="add-dish">+ 新增菜品</button>`)}
  <div class="filters"><input class="search" id="dish-search" placeholder="搜索当前分类" value="${esc(search)}">${displayCategories.map(x=>`<button class="filter-btn ${filter===x?'active':''}" data-action="filter" data-filter="${x}">${x}</button>`).join('')}</div>
  <section class="dish-grid">${paged.items.length?paged.items.map(libraryCard).join(''):'<div class="empty">当前分类还没有菜品。</div>'}</section>${pagination(page,paged.pages,'all')}`;
}
function planSelector(){
  return `<div class="inline-fields"><select id="plan-select" aria-label="当前菜单计划">${state.plans.map(p=>`<option value="${p.id}" ${p.id===state.currentPlanId?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
  <button class="btn secondary small" data-action="rename-plan">重命名</button><button class="btn secondary small" data-action="delete-plan" ${state.plans.length===1?'disabled':''}>删除</button></div>`;
}
function planItem(day,meal,item,index){
  if(item.blank)return `<div class="plan-item"><div><b>空白选项</b><br><small>等待智能生成填充</small></div><button class="text-btn" data-action="remove-item" data-day="${day}" data-meal="${meal}" data-index="${index}">×</button></div>`;
  const d=dishOf(state,item);if(!d)return '';
  const draggable=`draggable="true" data-draggable-item="true" data-day="${day}" data-meal="${meal}" data-index="${index}" data-drop-item-day="${day}" data-drop-item-meal="${meal}" data-drop-item-index="${index}" title="拖动调整位置或移至其他餐次"`;
  const preview=d.image
    ? `<img src="${esc(d.image)}" alt="${esc(d.name)}">`
    : `<span class="dish-preview-placeholder">${esc(d.name.slice(0,1))}</span>`;
  return `<div class="plan-item menu-dish draggable-dish" ${draggable}><div><b><span class="drag-handle">⋮⋮</span> <span class="dish-kind dish-preview-trigger" tabindex="0">${categoryIcon(d.category)}<span class="dish-preview">${preview}<small>${esc(d.name)}</small></span></span> ${esc(d.name)}</b><br><small>数量 <input class="item-quantity" data-day="${day}" data-meal="${meal}" data-index="${index}" type="number" min="1" value="${item.quantity||1}"> · 可拖动排序</small></div>
  <div class="item-actions"><button class="text-btn" data-action="move-up" data-day="${day}" data-meal="${meal}" data-index="${index}" title="上移">↑</button><button class="text-btn" data-action="move-down" data-day="${day}" data-meal="${meal}" data-index="${index}" title="下移">↓</button><button class="text-btn" data-action="replace" data-day="${day}" data-meal="${meal}" data-index="${index}">替换</button><button class="text-btn" data-action="remove-item" data-day="${day}" data-meal="${meal}" data-index="${index}">×</button></div></div>`;
}
function planView(){
  const p=plan();
  const folder=state.folders.find(x=>x.id===p.folderId);
  const profile=p.generationProfile;
  const profileText=profile?.mealTemplate
    ? `午餐/晚餐：${profile.mealTemplate.dishCount} 道主要菜品 + 1 道普通主食${profile.mealTemplate.dessertCount?` + ${profile.mealTemplate.dessertCount} 道甜品`:''}${profile.mealTemplate.otherCount?` + ${profile.mealTemplate.otherCount} 道汤饮/其他`:''}；早餐 ${profile.breakfastTemplate.dishCount} 道、肉类最多 1 道。独立一餐主食除外。${profile.budget?` 预算 ¥${Number(profile.budget).toFixed(2)}，生成预估 ¥${Number(profile.estimatedCost).toFixed(2)}${profile.estimatedCost>profile.budget?'（已尽量压低成本）':''}。`:''}`
    : profile?`规划结构：肉类 ${Math.round(profile.ratios.meat*100)}% · 蔬菜 ${Math.round(profile.ratios.vegetable*100)}% · 主食 ${Math.round(profile.ratios.staple*100)}% · 甜品/其他 ${Math.round(profile.ratios.other*100)}%`:'手动菜单可继续点菜，也可在任意餐次按类别即时添加菜品。';
  return `<div class="breadcrumb"><button data-action="start-root">START</button><span>›</span><button data-action="open-folder" data-id="${p.folderId}">${esc(folder?.name||'文件夹')}</button><span>›</span><b>${esc(p.name)}</b></div>
  ${header(p.name,`${p.type==='day'?'单日菜单':'周菜单'} · ${p.startDate} · ${p.people} 人`,`${backButton()}<button class="btn warm" data-action="open-smart-complete">智能补全菜单</button><button class="btn secondary" data-action="organize-plan">整理菜单</button>`)}
  <section class="hero"><h2>每日菜单</h2><p>${profileText}</p><p>菜单变化后，对应 LIST 会实时同步。</p></section>
  <section class="day-grid menu-days">${dayIndexes(p).map(day=>`<article class="day-card"><div class="day-title"><span>${p.type==='day'?'当天':`第 ${day+1} 天`}</span><small>${dateFor(p.startDate,day)}</small></div>
  ${[...p.meals,'自选'].map(meal=>{const items=getSlot(p,day,meal);if(meal==='自选'&&!items.length)return '';const dropAttrs=meal!=='自选'?`data-drop-day="${day}" data-drop-meal="${meal}"`:'';return `<div class="meal-block ${meal!=='自选'?'meal-drop-zone':''}" ${dropAttrs}><div class="meal-name"><span>${meal}</span><span>${items.filter(i=>!i.blank).length} 道</span></div>
  <div class="slot-items">${items.map((x,i)=>planItem(day,meal,x,i)).join('')||'<small class="meta">尚未安排</small>'}</div>${meal!=='自选'?`<div class="meal-add-actions"><button class="text-btn" data-action="generate-dish" data-day="${day}" data-meal="${meal}">+ 添加菜品</button><button class="text-btn" data-action="add-slot" data-day="${day}" data-meal="${meal}">单独点菜</button></div>`:''}</div>`}).join('')}
  </article>`).join('')}</section>`;
}
function orderCard(d){
  const count=orderSelection.filter(id=>id===d.id).length,image=d.image?`style="background-image:url('${d.image}')"`:'';
  return `<article class="dish-card order-card ${count?'selected':''}"><div class="dish-image" ${image}>${d.image?'':esc(d.name.slice(0,1))}</div><div class="dish-body"><div class="order-dish-heading"><h2 class="dish-title">${esc(d.name)}</h2><b class="order-price">¥${Number(d.price||0).toFixed(2)}</b></div><div class="meta">${categoryIcon(d.category)} ${esc(displayCategory(d))}</div><button class="text-btn order-detail-link" data-action="view-dish" data-id="${d.id}">查看详情</button></div>
  <div class="dish-foot"><button class="btn small" data-action="select-order" data-id="${d.id}">${count?`再加入（已选 ${count}）`:'加入'}</button>${count?`<button class="text-btn" data-action="unselect-order" data-id="${d.id}">减少</button>`:''}</div></article>`;
}
function orderView(){
  // 点菜页始终直接读取 ALL 使用的 state.dishes，不维护独立菜品副本。
  const p=plan();
  const valid=state.dishes.filter(d=>orderCategory==='全部'||displayCategory(d)===orderCategory);
  const selectedTotal=orderSelection.reduce((sum,id)=>sum+Number(dish(id)?.price||0),0);
  const budget=Number(p.budget)||0,overBudget=budget>0&&selectedTotal>budget;
  const budgetDisplay=`<div class="order-budget ${overBudget?'over-budget':''}"><span>当前预算</span> <b>¥${selectedTotal.toFixed(2)}</b><span>/${budget?`¥${budget.toFixed(2)}`:'未设置'}</span></div>`;
  let page=orderPages[orderCategory]||1;const paged=pageSlice(valid,page);if(page>paged.pages){page=paged.pages;orderPages[orderCategory]=page}
  return `${header('选择菜品',`正在为“${esc(p.name)}”${orderTarget?`的第 ${orderTarget.day+1} 天${esc(orderTarget.meal)}`:''}点菜 · 人工选择不受生成规则限制`,`${backButton()}<button class="btn warm" data-action="submit-order" ${orderSelection.length?'':'disabled'}>提交并整理（${orderSelection.length} 道）</button>`)}
  <div class="notice">菜品由 ALL 实时同步，不在点菜页单独导入或更新。已选内容会在返回时保留。</div>
  <div class="filters order-filter-bar"><div class="order-category-tabs">${displayCategories.map(x=>`<button class="filter-btn ${orderCategory===x?'active':''}" data-action="order-filter" data-filter="${x}">${x}</button>`).join('')}</div>${budgetDisplay}</div>
  <section class="dish-grid">${paged.items.length?paged.items.map(orderCard).join(''):'<div class="empty">当前分类没有支持该人数的菜品。</div>'}</section>${pagination(page,paged.pages,'order')}`;
}
function menuCreateForm(folder){
  const p=plan()||{people:4,meals:['早餐','午餐','晚餐'],goal:'均衡',maxSpicy:5,cuisines:[]};
  return `<section class="summary-panel"><div class="page-head"><h2>创建菜单</h2>${backButton()}</div><form id="new-plan-form" data-folder-id="${folder.id}">
  <div class="form-grid"><div class="field"><label>菜单名称</label><input required name="name" placeholder="例如：2026年7月第一周菜单"></div>
  <div class="field"><label>菜单类型</label><select name="type"><option value="week">新的一周</option><option value="day">新的一天</option></select></div>
  <div class="field"><label>开始日期</label><input type="date" name="startDate" value="${new Date().toISOString().slice(0,10)}"></div>
  <div class="field"><label>用餐人数</label><select name="people">${servingOptions.map(n=>`<option value="${n}" ${p.people===n?'selected':''}>${n} 人</option>`).join('')}</select></div>
  <div class="field wide"><label>每日餐次</label><div class="check-row">${checks('meals',meals,p.meals)}</div></div>
  <div class="field wide"><label>可接受的最高辣度</label>${spicyChoices('maxSpicy',p.maxSpicy??5)}<small class="meta">选择 0 星仅允许不辣；5 星允许全部辣度。</small></div>
  <div class="field wide"><label>菜系限制（可多选，不选表示不限）</label><div class="check-row">${checks('cuisines',cuisineOptions,p.cuisines||[])}</div></div>
  <div class="field"><label>菜单总预算（元，可选）</label><input type="number" name="budget" min="0" step="1" placeholder="例如：500"></div>
  <div class="field"><label>忌口</label><input name="dislike" placeholder="例如：香菜，牛肉"></div></div>
  <div class="actions"><button class="btn" type="submit" name="intent" value="order">创建并选择菜品</button><button class="btn secondary" type="submit" name="intent" value="blank">创建空白菜单</button></div></form></section>`;
}
function startView(){
  if(startPlanOpen)return planView();
  if(startFolderId){
    const folder=state.folders.find(x=>x.id===startFolderId);
    if(!folder){startFolderId=null;return startView()}
    const menus=state.plans.filter(p=>p.folderId===folder.id);
    return `<div class="breadcrumb"><button data-action="start-root">START</button><span>›</span><b>${esc(folder.name)}</b></div>
    ${header(folder.name,`${menus.length} 个菜单`,`${backButton()}<button class="btn" data-action="toggle-create-menu">+ 创建菜单</button>`)}
    <section class="workspace-grid">${menus.map(menu=>`<article class="workspace-card workspace-open-card menu-card" role="button" tabindex="0" aria-label="打开菜单 ${esc(menu.name)}" data-action="open-plan" data-id="${menu.id}"><span class="card-icon">▦</span><b>${esc(menu.name)}</b><small>${menu.startDate}<br>${menu.people} 人 · ${menu.type==='day'?'1 天':`${menu.days} 天`}<br>预算：${menu.budget?`¥${Number(menu.budget).toFixed(2)}`:'未设置'}</small><span class="card-corner-actions"><button class="text-btn card-delete" data-action="delete-menu" data-id="${menu.id}" aria-label="删除菜单 ${esc(menu.name)}">删除</button></span></article>`).join('')||'<div class="empty">这个文件夹还没有菜单。</div>'}</section>
    ${menuCreateOpen?menuCreateForm(folder):''}`;
  }
  return `${header('START','选择一个文件夹，管理其中的菜单。','<button class="btn" data-action="create-folder">+ 创建文件夹</button>')}
  ${folderCreateOpen?`<section class="summary-panel compact-form"><form id="folder-create-form"><div class="inline-fields"><input required name="name" maxlength="40" placeholder="输入文件夹名称" autofocus><button class="btn" type="submit">创建并打开</button><button class="btn secondary" type="button" data-action="cancel-folder-create">取消</button></div></form></section>`:''}
  <section class="workspace-grid">${state.folders.map(folder=>{const count=state.plans.filter(p=>p.folderId===folder.id).length;return `<article class="workspace-card workspace-open-card folder-card" role="button" tabindex="0" aria-label="打开文件夹 ${esc(folder.name)}" data-action="open-folder" data-id="${folder.id}"><span class="card-icon">▰</span><b>${esc(folder.name)}</b><small>${new Date(folder.createdAt).toLocaleDateString('zh-CN')}<br>${count} 个菜单</small><span class="card-corner-actions"><button class="text-btn card-delete" data-action="delete-folder" data-id="${folder.id}" aria-label="删除文件夹 ${esc(folder.name)}">删除</button></span></article>`}).join('')}</section>`;
}
function shoppingView(){
  if(!listFolderId)return `${header('LIST','第一步：选择文件夹。')}<section class="workspace-grid">${state.folders.map(folder=>`<button class="workspace-card" data-action="list-folder" data-id="${folder.id}"><span class="card-icon">▰</span><b>${esc(folder.name)}</b><small>${state.plans.filter(p=>p.folderId===folder.id).length} 个菜单</small></button>`).join('')||'<div class="empty">请先在 START 创建文件夹。</div>'}</section>`;
  const folder=state.folders.find(x=>x.id===listFolderId);
  const menus=state.plans.filter(p=>p.folderId===listFolderId);
  const selectedPlans=menus.filter(menu=>listMenuIds.has(menu.id));
  const details=selectedPlans.map(menu=>{
    const items=shoppingSummary(state,menu);
    const actual=items.reduce((sum,item)=>sum+Number(dish(item.id)?.price||0)*Number(item.quantity||0),0);
    const budget=Number(menu.budget)||0;
    return {menu,items,actual,budget,over:Math.max(0,actual-budget)};
  });
  const totalBudget=details.reduce((sum,x)=>sum+x.budget,0);
  const actualTotal=details.reduce((sum,x)=>sum+x.actual,0);
  const totalOver=Math.max(0,actualTotal-totalBudget);
  const mergedMap=new Map();
  details.flatMap(x=>x.items).forEach(item=>{
    const current=mergedMap.get(item.id)||{...item,quantity:0};
    current.quantity+=Number(item.quantity||0);mergedMap.set(item.id,current);
  });
  const items=[...mergedMap.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  return `${header('LIST',`第二步：选择“${esc(folder?.name||'文件夹')}”中的一个或多个菜单。`,'<button class="btn secondary" data-action="list-back">← 返回上一步</button>')}
  <div class="list-menu-picker">${menus.map(menu=>`<label><input type="checkbox" value="${menu.id}" data-action="list-menu" ${listMenuIds.has(menu.id)?'checked':''}> ${esc(menu.name)}</label>`).join('')||'<div class="empty">这个文件夹还没有菜单。</div>'}</div>
  ${details.length?`<section class="summary-panel list-analysis">
    <div class="list-summary-head"><small>${details.length>1?'多菜单汇总':'菜单成本'}</small><h2>${details.length>1?`已选择 ${details.length} 个菜单`:esc(details[0].menu.name)}</h2></div>
    <div class="cost-summary"><div><span>总预算</span><b>${totalBudget?`¥${totalBudget.toFixed(2)}`:'未设置'}</b></div><div><span>实际总价</span><b>¥${actualTotal.toFixed(2)}</b></div><div class="${totalOver>0?'cost-over':''}"><span>超出</span><b>¥${totalOver.toFixed(2)}</b></div></div>
    <div class="menu-cost-breakdown">${details.map(x=>`<article><b>${esc(x.menu.name)}</b><span>预算 ${x.budget?`¥${x.budget.toFixed(2)}`:'未设置'}</span><span>实际 ¥${x.actual.toFixed(2)}</span><span class="${x.over>0?'cost-over-text':''}">超出 ¥${x.over.toFixed(2)}</span></article>`).join('')}</div>
    <div class="shopping-heading"><h3>采购清单</h3><small>相同菜品已自动合并</small></div>
    ${items.length?items.map(x=>`<div class="plan-item shopping-item"><div><b>${esc(x.name)}</b>${x.ingredients?.length?`<small class="shopping-ingredients">${x.ingredients.map(esc).join('、')}</small>`:''}</div><span>¥${Number(dish(x.id)?.price||0).toFixed(2)} × ${x.quantity}</span></div>`).join(''):'<div class="empty">所选菜单还没有安排菜品。</div>'}
  </section><p class="footer-note">多选只用于实时查看和汇总，不会修改任何菜单、预算或菜品数据。</p>`:'<div class="empty">请选择至少一个菜单查看预算和采购汇总。</div>'}`;
}
function render(){
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  const syncStatus=cloudBootstrapping
    ? '<div class="cloud-startup-status" role="status"><b>本地菜单已显示</b><span>正在校准云端最新数据，完成前暂不可编辑。</span></div>'
    : cloudStartupError
      ? `<div class="cloud-startup-status error"><b>当前使用本地数据</b><span>${esc(cloudStartupError)}</span><button class="text-btn" data-action="retry-cloud-startup">重新连接</button></div>`
      : '';
  app.innerHTML=syncStatus+(view==='library'?libraryView():view==='start'?startView():view==='order'?orderView():shoppingView());
}

async function hydrateFromCloud(){
  if(cloudBootstrapping!==true)cloudBootstrapping=true;
  cloudStartupError='';
  render();
  try{
    const result=await syncCloudState(state);
    state=result.state;
    removedLegacyBlanks=cleanLegacyBlanks(state);
    cloudStartupError=result.error?'云端连接失败，修改将先保存在本机，恢复连接后再同步。':'';
    if(removedLegacyBlanks&&!result.error)save(state);
  }catch(error){
    console.error('应用启动校准失败',error);
    cloudStartupError='云端校准失败，已安全保留本地菜单。可稍后重新连接。';
  }finally{
    cloudBootstrapping=false;
    render();
  }
}

function openDish(source){
  const editing=Boolean(source),d=source||{name:'',category:'肉菜',ingredients:[],tags:[],healthTags:[],cuisine:['中餐'],meals:['午餐','晚餐'],mainOnly:false,favorite:false,image:'',price:0,spicyLevel:0};
  dishDialog.innerHTML=`<form class="modal-inner" id="dish-form"><h2>${editing?'编辑菜品':'新增菜品'}</h2><div class="form-grid">
  <div class="field"><label>菜名</label><input required name="name" value="${esc(d.name)}"></div><div class="field"><label>分类</label><select name="category">${categories.map(c=>`<option ${d.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
  <div class="field"><label>价格（元）</label><input required type="number" name="price" min="0" step="0.01" value="${Number(d.price||0)}"></div>
  <div class="field wide"><label>辣度</label>${spicyChoices('spicyLevel',d.spicyLevel||0)}</div>
  <div class="field wide"><label>主要食材（仅作为菜品资料）</label><input name="ingredients" value="${esc(d.ingredients.join(','))}"></div>
  <div class="field wide"><label>食材分类</label><div class="check-row">${checks('tags',ingredientTags,d.tags||[])}</div></div>
  <div class="field wide"><label>健康标签（固定选项，可多选）</label><div class="check-row">${checks('healthTags',healthTags,d.healthTags)}</div></div>
  <div class="field wide"><label>菜系分类（固定选项，可多选）</label><div class="check-row">${checks('cuisine',cuisineOptions,Array.isArray(d.cuisine)?d.cuisine:[d.cuisine].filter(Boolean))}</div></div>
  <div class="field wide"><label><input type="checkbox" name="mainOnly" ${d.mainOnly?'checked':''}> 独立一餐主食</label><small>仅对主食生效；启用后，该主食自动生成时会单独组成一餐。</small></div>
  <div class="field wide"><label>适合餐次</label><div class="check-row">${checks('meals',meals,d.meals)}</div></div><div class="field wide"><label>图片</label><input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif"><small class="image-help">选择后需按 ALL 菜品卡片的 3:2 比例裁剪，最终保存为 600 × 400 px。</small><div class="image-upload-preview" ${d.image?`style="background-image:url('${d.image}')"`:''}>${d.image?'':'尚未选择图片'}</div><p class="image-process-status" aria-live="polite"></p></div></div>
  <div class="modal-actions"><button class="btn secondary" type="button" data-action="close-dialog">取消</button><button class="btn" type="submit">保存</button></div></form>`;
  dishDialog.showModal();
  const dishForm=document.querySelector('#dish-form');
  let croppedImage='',imageProcessing=false;
  const imageInput=dishForm.elements.image,preview=dishForm.querySelector('.image-upload-preview'),status=dishForm.querySelector('.image-process-status');
  imageInput.addEventListener('change',async()=>{
    const file=imageInput.files?.[0];if(!file)return;
    imageProcessing=true;status.textContent='正在处理图片...';
    try{
      croppedImage=await cropImageFile(file);
      preview.style.backgroundImage=`url("${croppedImage}")`;preview.textContent='';
      status.textContent='图片处理完成';
      showToast('图片处理完成');
    }catch(error){
      croppedImage='';imageInput.value='';status.textContent=error.message==='已取消图片裁剪'?'已取消图片裁剪':'图片上传失败，请重试';
      if(error.message!=='已取消图片裁剪')showToast(error.message||'图片上传失败，请重试。','error');
    }finally{imageProcessing=false}
  });
  dishForm.addEventListener('submit',async e=>{
    e.preventDefault();
    const form=e.currentTarget,fd=new FormData(form),selectedMeals=fd.getAll('meals');
    if(!selectedMeals.length)return showToast('请至少选择一个适合餐次。','error');
    if(imageProcessing)return showToast('图片仍在处理中，请先完成裁剪。','error');
    const submitButton=e.submitter;
    await runBusy(submitButton,croppedImage?'图片上传中...':'正在保存...',async()=>{
      try{
        const image=croppedImage||d.image||'';
        const spicyLevel=Number(form.querySelector('.star-picker[data-name="spicyLevel"]')?.dataset.value||0);
        const category=fd.get('category');
        const next={...d,id:editing?d.id:uid('dish'),name:fd.get('name').trim(),category,price:Math.max(0,Number(fd.get('price'))||0),spicyLevel:Math.max(0,Math.min(5,spicyLevel)),ingredients:splitList(fd.get('ingredients')),tags:fd.getAll('tags'),healthTags:fd.getAll('healthTags'),cuisine:fd.getAll('cuisine').length?fd.getAll('cuisine'):['其他'],meals:selectedMeals,mainOnly:category==='主食'&&fd.has('mainOnly'),favorite:Boolean(d.favorite),image};
        const previous=state.dishes;
        state.dishes=editing?state.dishes.map(x=>x.id===d.id?next:x):[next,...state.dishes];
        if(!save(state)){state.dishes=previous;return showToast('保存失败：本地存储空间不足，请换用更小的图片。','error')}
        dishDialog.close();render();showToast(editing?'菜品更新成功。':'菜品保存成功。');
      }catch(error){console.error(error);showToast(error.message||'图片上传失败，请重试。','error')}
    });
  });
}
function openDishDetail(d){
  if(!d)return;
  const image=d.image
    ? `<img src="${esc(d.image)}" alt="${esc(d.name)}">`
    : `<div class="detail-image-placeholder">${esc(d.name.slice(0,1))}</div>`;
  const tags=(values,suffix='')=>values?.length
    ? `<div class="detail-tags">${values.map(value=>`<span class="tag">${esc(value)}${suffix}</span>`).join('')}</div>`
    : '';
  const optionalSections=[
    ['菜品介绍',d.description],
    ['做法说明',d.instructions],
    ['营养信息',d.nutrition],
    ['备注',d.notes]
  ].filter(([,value])=>String(value||'').trim());
  dishDialog.innerHTML=`<article class="dish-detail">
    <button class="detail-close" type="button" data-action="close-dialog" aria-label="关闭">×</button>
    <div class="detail-hero">${image}<div class="detail-hero-copy"><span class="detail-eyebrow">菜品档案</span><h2>${esc(d.name)}</h2><p>${categoryIcon(d.category)} ${esc(displayCategory(d))}</p></div></div>
    <div class="detail-content">
      <section class="detail-facts">
        <div class="detail-section"><h3>分类</h3><p class="detail-category">${categoryIcon(d.category)} ${esc(displayCategory(d))}</p></div>
        ${d.cuisine?.length?`<div class="detail-section"><h3>菜系</h3>${tags(Array.isArray(d.cuisine)?d.cuisine:[d.cuisine])}</div>`:''}
        ${d.mainOnly?`<div class="detail-section"><h3>主食规则</h3>${tags(['独立一餐'])}</div>`:''}
        <div class="detail-section"><h3>辣度</h3><p class="detail-spicy" aria-label="${Number(d.spicyLevel||0)} 星辣度">${spicyStars(d.spicyLevel||0)}</p></div>
        ${Number.isFinite(Number(d.price))?`<div class="detail-section"><h3>参考价格</h3><p class="detail-price">¥${Number(d.price||0).toFixed(2)}</p></div>`:''}
        ${d.meals?.length?`<div class="detail-section"><h3>适合餐次</h3>${tags(d.meals)}</div>`:''}
        ${d.tags?.length?`<div class="detail-section"><h3>食材分类</h3>${tags(d.tags)}</div>`:''}
        ${d.healthTags?.length?`<div class="detail-section"><h3>已有标签</h3>${tags(d.healthTags)}</div>`:''}
      </section>
      ${d.ingredients?.length?`<section class="detail-section detail-wide"><h3>主要食材</h3><p>${d.ingredients.map(esc).join('、')}</p></section>`:''}
      ${optionalSections.map(([label,value])=>`<section class="detail-section detail-wide"><h3>${label}</h3><p>${esc(value)}</p></section>`).join('')}
    </div>
  </article>`;
  dishDialog.showModal();
}
function openGeneratedDish(day,meal){
  const p=plan();
  const options=[['肉类','肉菜'],['蔬菜类','蔬菜'],['甜品类','甜品'],['其他','其他']];
  slotDialog.innerHTML=`<form class="modal-inner" id="generate-dish-form"><h2>${meal} · 添加菜品</h2>
  <p class="meta">系统会按当前用餐人数和所选类别生成一道当天未出现的菜，并追加到本餐最下方。</p>
  <div class="field"><label>请选择生成类型</label><div class="check-row">${options.map(([label,value],i)=>`<label><input type="radio" name="category" value="${value}" ${i===0?'checked':''}> ${label}</label>`).join('')}</div></div>
  <div class="modal-actions"><button class="btn secondary" type="button" data-action="close-dialog">取消</button><button class="btn" type="submit">生成并添加</button></div></form>`;
  slotDialog.showModal();
  document.querySelector('#generate-dish-form').addEventListener('submit',e=>{
    e.preventDefault();
    const category=new FormData(e.currentTarget).get('category');
    const dayDishIds=new Set(Object.entries(p.slots).filter(([key])=>key.startsWith(`${day}|`)).flatMap(([,items])=>items).filter(x=>x.dishId).map(x=>x.dishId));
    const candidates=eligible(state,p,meal).filter(d=>matchesGeneratedCategory(d,category)&&!dayDishIds.has(d.id));
    if(!candidates.length)return showToast('没有符合当前人数、餐次和类别且当天未使用的候选菜品。','error');
    const healthMatches=candidates.filter(d=>d.healthTags?.includes(p.goal));
    const pool=healthMatches.length?healthMatches:candidates;
    const selected=pool[Math.floor(Math.random()*pool.length)];
    const key=slotKey(day,meal);
    p.slots[key]=[...getSlot(p,day,meal),{dishId:selected.id,quantity:selected.category==='主食'?Number(p.people):1,locked:false}];
    slotDialog.close();
    persist('菜品已生成并加入菜单。');
  });
}
function openSmartComplete(){
  const healthDefault=plan()?.goal==='高蛋白'?'高蛋白':plan()?.goal==='清淡'?'少油少盐':'均衡营养';
  slotDialog.innerHTML=`<form class="modal-inner smart-complete-form" id="smart-complete-form">
    <h2>智能补全菜单</h2>
    <p class="meta">补全会保留全部已有菜品，先分析结构，再只补充缺少的内容。</p>
    <div class="form-grid">
      <div class="field"><label>健康方向</label><select name="health">${menuPreferenceOptions.health.map(value=>`<option ${value===healthDefault?'selected':''}>${value}</option>`).join('')}</select></div>
      <div class="field"><label>人群方向</label><select name="audience">${menuPreferenceOptions.audience.map(value=>`<option>${value}</option>`).join('')}</select></div>
      <div class="field"><label>场景方向</label><select name="scene">${menuPreferenceOptions.scene.map(value=>`<option>${value}</option>`).join('')}</select></div>
    </div>
    <div class="notice">老人和儿童仅作为本次菜单规划规则，不会写入菜品标签。</div>
    <div class="modal-actions"><button class="btn secondary" type="button" data-action="close-dialog">取消</button><button class="btn warm" type="button" data-action="run-smart-complete">确认并智能补全</button></div>
  </form>`;
  if(!slotDialog.open)slotDialog.showModal();
}

const splitList=v=>String(v||'').split(/[，,、]/).map(x=>x.trim()).filter(Boolean);
const readFileData=file=>new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>no(new Error('无法读取图片文件'));r.readAsDataURL(file)});
const loadImage=src=>new Promise((ok,no)=>{const image=new Image();image.onload=()=>ok(image);image.onerror=()=>no(new Error('图片格式无法解析'));image.src=src});
async function cropImageFile(file){
  if(!file?.size)return '';
  if(!/^image\/(jpeg|png|webp|gif)$/i.test(file.type))throw new Error('仅支持 JPG、PNG、WebP 或 GIF 图片。');
  if(file.size>8*1024*1024)throw new Error('图片不能超过 8MB。');
  const original=await readFileData(file);
  const image=await loadImage(original);
  return new Promise((resolve,reject)=>{
    const ratio=imageRatios.allCard,outputWidth=ratio.outputWidth,outputHeight=ratio.outputHeight;
    const dialog=document.createElement('dialog');dialog.className='modal crop-dialog';
    dialog.innerHTML=`<section class="modal-inner"><h2>裁剪菜品图片</h2><p class="meta">裁剪比例跟随 ALL 菜品卡片（${ratio.width}:${ratio.height}）。拖动图片调整位置，使用滑块缩放。</p>
      <div class="crop-stage" style="--crop-ratio:${ratio.width}/${ratio.height}"><canvas width="${outputWidth}" height="${outputHeight}" aria-label="图片裁剪预览"></canvas><span class="crop-frame" aria-hidden="true"></span></div>
      <label class="crop-zoom">缩放 <input type="range" min="1" max="3" step="0.01" value="1"><output>100%</output></label>
      <div class="modal-actions"><button class="btn secondary crop-cancel" type="button">取消</button><button class="btn crop-confirm" type="button">确认裁剪</button></div></section>`;
    document.body.append(dialog);
    const canvas=dialog.querySelector('canvas'),context=canvas.getContext('2d'),range=dialog.querySelector('input'),output=dialog.querySelector('output');
    if(!context){dialog.remove();reject(new Error('浏览器无法处理该图片。'));return}
    const baseScale=Math.max(outputWidth/image.naturalWidth,outputHeight/image.naturalHeight);
    let zoom=1,x=(outputWidth-image.naturalWidth*baseScale)/2,y=(outputHeight-image.naturalHeight*baseScale)/2,dragging=false,lastX=0,lastY=0,done=false;
    const constrain=()=>{
      const w=image.naturalWidth*baseScale*zoom,h=image.naturalHeight*baseScale*zoom;
      x=Math.min(0,Math.max(outputWidth-w,x));y=Math.min(0,Math.max(outputHeight-h,y));
    };
    const draw=()=>{
      constrain();context.clearRect(0,0,outputWidth,outputHeight);
      context.drawImage(image,x,y,image.naturalWidth*baseScale*zoom,image.naturalHeight*baseScale*zoom);
    };
    const finish=(value,error)=>{
      if(done)return;done=true;dialog.close();dialog.remove();
      error?reject(error):resolve(value);
    };
    range.addEventListener('input',()=>{
      const previous=zoom;zoom=Number(range.value);x=outputWidth/2-(outputWidth/2-x)*(zoom/previous);y=outputHeight/2-(outputHeight/2-y)*(zoom/previous);
      output.value=`${Math.round(zoom*100)}%`;draw();
    });
    canvas.addEventListener('pointerdown',event=>{dragging=true;lastX=event.clientX;lastY=event.clientY;canvas.setPointerCapture(event.pointerId)});
    canvas.addEventListener('pointermove',event=>{if(!dragging)return;const pointerScale=outputWidth/canvas.getBoundingClientRect().width;x+=(event.clientX-lastX)*pointerScale;y+=(event.clientY-lastY)*pointerScale;lastX=event.clientX;lastY=event.clientY;draw()});
    const stop=()=>{dragging=false};canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);
    dialog.querySelector('.crop-cancel').addEventListener('click',()=>finish('',new Error('已取消图片裁剪')));
    dialog.querySelector('.crop-confirm').addEventListener('click',()=>{
      const cropped=canvas.toDataURL('image/jpeg',.84);
      if(cropped.length>2.8*1024*1024)return finish('',new Error('裁剪后的图片仍然过大，请重试。'));
      finish(cropped);
    });
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish('',new Error('已取消图片裁剪'))});
    draw();dialog.showModal();
  });
}
function download(name,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.download=name;a.click();URL.revokeObjectURL(a.href)}

document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-action],[data-view]');if(!el)return;if(el.dataset.view){view=el.dataset.view;if(view==='start'){startFolderId=null;startPlanOpen=false;folderCreateOpen=false;menuCreateOpen=false;startHistory=[]}if(view==='shopping'){listFolderId=null;listMenuIds=new Set()}render();return}
  const {action,id,meal}=el.dataset,day=Number(el.dataset.day),index=Number(el.dataset.index),p=plan();
  if(action==='retry-cloud-startup'){cloudBootstrapping=true;hydrateFromCloud();return}
  const startupSafeActions=new Set(['filter','order-filter','page-prev','page-next','page-set','view-dish','close-dialog']);
  if(cloudBootstrapping&&!startupSafeActions.has(action)){
    showToast('正在校准云端最新数据，请稍候再编辑。','error');return;
  }
  if(operationBusy&&action!=='close-dialog')return;
  if(action==='add-dish')openDish();if(action==='view-dish')openDishDetail(dish(id));if(action==='edit-dish')openDish(dish(id));if(action==='close-dialog')el.closest('dialog')?.close();
  if(action==='set-spicy'){
    const picker=el.closest('.star-picker'),level=Number(el.dataset.level),current=Number(picker.dataset.value);
    picker.dataset.value=String(current===level?0:level);
    picker.querySelectorAll('[data-level]').forEach(star=>{
      const selected=Number(star.dataset.level)<=Number(picker.dataset.value);
      star.classList.toggle('selected',selected);star.textContent=selected?'★':'☆';star.setAttribute('aria-pressed',String(selected))
    });
  }
  if(action==='delete-dish'&&confirm('删除这道菜？已保存菜单中的相关项目也会同步移除。')){
    state.dishes=state.dishes.filter(d=>d.id!==id);
    state.plans.forEach(menuPlan=>Object.keys(menuPlan.slots||{}).forEach(key=>{menuPlan.slots[key]=(menuPlan.slots[key]||[]).filter(item=>item.dishId!==id)}));
    persist('菜品及菜单中的相关项目已删除。')
  }
  if(action==='favorite'){dish(id).favorite=!dish(id).favorite;persist()}if(action==='filter'){filter=el.dataset.filter;render()}
  if(action==='order-filter'){orderCategory=el.dataset.filter;render()}
  if(action==='page-prev'){if(el.dataset.scope==='all')allPages[filter]=Math.max(1,(allPages[filter]||1)-1);else orderPages[orderCategory]=Math.max(1,(orderPages[orderCategory]||1)-1);render()}
  if(action==='page-next'){if(el.dataset.scope==='all')allPages[filter]=(allPages[filter]||1)+1;else orderPages[orderCategory]=(orderPages[orderCategory]||1)+1;render()}
  if(action==='page-set'){if(el.dataset.scope==='all')allPages[filter]=Number(el.dataset.page);else orderPages[orderCategory]=Number(el.dataset.page);render()}
  if(action==='create-folder'){folderCreateOpen=true;render()}
  if(action==='cancel-folder-create'){folderCreateOpen=false;render()}
  if(action==='open-folder'){rememberStart();startFolderId=id;startPlanOpen=false;folderCreateOpen=false;menuCreateOpen=false;view='start';render()}
  if(action==='start-root'){startHistory=[];startFolderId=null;startPlanOpen=false;folderCreateOpen=false;menuCreateOpen=false;view='start';render()}
  if(action==='start-back'){const leavingOrder=view==='order',previous=startHistory.pop();if(previous){startFolderId=previous.startFolderId;startPlanOpen=previous.startPlanOpen;folderCreateOpen=previous.folderCreateOpen;menuCreateOpen=previous.menuCreateOpen;view=previous.view}else if(menuCreateOpen){menuCreateOpen=false}else if(folderCreateOpen){folderCreateOpen=false}if(leavingOrder)orderTarget=null;render()}
  if(action==='delete-folder'&&confirm('确认删除这个文件夹及其中所有菜单？此操作无法撤销。')){const removedIds=new Set(state.plans.filter(x=>x.folderId===id).map(x=>x.id));state.plans=state.plans.filter(x=>x.folderId!==id);state.folders=state.folders.filter(x=>x.id!==id);if(removedIds.has(state.currentPlanId))state.currentPlanId=state.plans[0]?.id||'';if(listFolderId===id){listFolderId=null;listMenuIds=new Set()}startFolderId=null;startPlanOpen=false;persist('文件夹及关联菜单已删除。')}
  if(action==='toggle-create-menu'){rememberStart();menuCreateOpen=true;render()}
  if(action==='go-order'){slotDialog.open&&slotDialog.close();rememberStart();orderTarget=null;orderCategory='全部';view='order';render()}if(action==='select-order'){orderSelection.push(id);render()}
  if(action==='unselect-order'){const i=orderSelection.lastIndexOf(id);if(i>=0)orderSelection.splice(i,1);render()}
  if(action==='submit-order'){
    await runBusy(el,'正在整理...',async()=>{
      const previousSlots=structuredClone(p.slots||{});
      if(orderTarget){
        const key=slotKey(orderTarget.day,orderTarget.meal);
        p.slots[key]=[...getSlot(p,orderTarget.day,orderTarget.meal),...orderSelection.map(dishId=>{const selected=dish(dishId);return {dishId,quantity:selected?.category==='主食'?Number(p.people):1,servings:Number(p.people),locked:false}})];
      }else p.slots=buildSelectedPlan(state,p,orderSelection,false);
      p.autoFillMenu=false;
      if(!save(state)){p.slots=previousSlots;return showToast('菜单保存失败，请释放本地存储空间后重试。','error')}
      orderSelection=[];orderTarget=null;view='start';startPlanOpen=true;render();showToast('已保留所选菜品，请在菜单整理页继续调整或智能补全。')
    })
  }
  if(action==='open-smart-complete')openSmartComplete();
  if(action==='run-smart-complete'){
    const form=el.closest('#smart-complete-form'),fd=new FormData(form);
    const preferences={health:fd.get('health'),audience:fd.get('audience'),scene:fd.get('scene')};
    await runBusy(el,'正在补全...',async()=>{
      const previousSlots=structuredClone(p.slots||{}),previousGoal=p.goal,previousProfile=p.generationProfile;
      const result=completeExistingMenu(state,p,preferences);
      p.slots=result.slots;p.autoFillMenu=true;
      if(!save(state)){p.slots=previousSlots;p.goal=previousGoal;p.generationProfile=previousProfile;return showToast('菜单保存失败，请释放本地存储空间后重试。','error')}
      slotDialog.close();render();
      showToast(result.before.missing?`已智能补充 ${result.before.missing} 道菜品。`:'菜单结构已完整，无需补充。')
    })
  }
  if(action==='add-slot'){rememberStart();orderSelection=[];orderTarget={day,meal};orderCategory='全部';view='order';render()}
  if(action==='generate-dish')openGeneratedDish(day,meal);
  if(action==='organize-plan'){Object.values(p.slots).forEach(items=>items.sort((a,b)=>{if(a.blank)return 1;if(b.blank)return -1;return categoryRank(dishOf(state,a)?.category)-categoryRank(dishOf(state,b)?.category)}));persist('菜单已整理。')}
  if(action==='move-up'||action==='move-down'){const items=p.slots[slotKey(day,meal)]||[],next=action==='move-up'?index-1:index+1;if(next>=0&&next<items.length){[items[index],items[next]]=[items[next],items[index]];persist()}}
  if(action==='remove-item'){p.slots[slotKey(day,meal)].splice(index,1);persist('菜品已从菜单移除。')}if(action==='replace'){if(replaceDish(state,p,day,meal,index))persist('菜品替换成功。');else showToast('没有其他同时符合人数、餐次、菜系、辣度和忌口要求的同类菜品。','error')}
  if(action==='open-plan'){rememberStart();state.currentPlanId=id;startFolderId=plan().folderId;startPlanOpen=true;orderSelection=[];orderTarget=null;if(!save(state))showToast('当前菜单状态保存失败。','error');view='start';render()}
  if(action==='delete-menu'&&state.plans.length>1&&confirm('删除这个菜单？')){state.plans=state.plans.filter(x=>x.id!==id);if(state.currentPlanId===id)state.currentPlanId=state.plans[0].id;persist()}
  if(action==='rename-plan'){const name=prompt('新的计划名称',p.name);if(name?.trim()){p.name=name.trim();persist()}}
  if(action==='delete-plan'&&state.plans.length>1&&confirm(`删除“${p.name}”？`)){state.plans=state.plans.filter(x=>x.id!==p.id);state.currentPlanId=state.plans[0].id;startPlanOpen=false;persist()}
  if(action==='list-folder'){listFolderId=id;listMenuIds=new Set();render()}
  if(action==='list-back'){listFolderId=null;listMenuIds=new Set();render()}
  if(action==='list-menu'){if(el.checked)listMenuIds.add(el.value);else listMenuIds.delete(el.value);render()}
  if(action==='export-dishes')download('菜品库.json',JSON.stringify(state.dishes,null,2));if(action==='print')window.print();
});
document.addEventListener('change',e=>{
  if(cloudBootstrapping){showToast('正在校准云端最新数据，请稍候再编辑。','error');render();return}
  if(e.target.id==='plan-select'){state.currentPlanId=e.target.value;if(!save(state))showToast('当前菜单状态保存失败。','error');render()}
  if(e.target.matches('.item-quantity')){const p=plan(),item=getSlot(p,Number(e.target.dataset.day),e.target.dataset.meal)[Number(e.target.dataset.index)];item.quantity=Math.max(1,Number(e.target.value)||1);persist()}
});
document.addEventListener('input',e=>{if(e.target.id==='dish-search'){search=e.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>render(),120)}});
document.addEventListener('keydown',e=>{
  const openCard=e.target.closest('.workspace-open-card[data-action]');
  if(!openCard||e.target.closest('button')||!['Enter',' '].includes(e.key))return;
  e.preventDefault();openCard.click();
});
document.addEventListener('dragstart',e=>{
  if(cloudBootstrapping){e.preventDefault();showToast('正在校准云端最新数据，请稍候再编辑。','error');return}
  const item=e.target.closest('[data-draggable-item]');if(!item)return;
  draggedMenuItem={day:Number(item.dataset.day),meal:item.dataset.meal,index:Number(item.dataset.index)};
  item.classList.add('is-dragging');if(e.dataTransfer)e.dataTransfer.effectAllowed='move';
});
document.addEventListener('dragover',e=>{const zone=e.target.closest('[data-drop-day][data-drop-meal]');if(!zone||!draggedMenuItem)return;e.preventDefault();zone.classList.add('drag-over');if(e.dataTransfer)e.dataTransfer.dropEffect='move'});
document.addEventListener('dragleave',e=>{const zone=e.target.closest('[data-drop-day][data-drop-meal]');if(zone&&!zone.contains(e.relatedTarget))zone.classList.remove('drag-over')});
document.addEventListener('drop',e=>{
  const zone=e.target.closest('[data-drop-day][data-drop-meal]');if(!zone||!draggedMenuItem)return;e.preventDefault();
  const p=plan(),sourceKey=slotKey(draggedMenuItem.day,draggedMenuItem.meal),source=p.slots[sourceKey]||[];
  const targetItem=e.target.closest('[data-drop-item-day][data-drop-item-meal][data-drop-item-index]');
  const targetDay=targetItem?Number(targetItem.dataset.dropItemDay):Number(zone.dataset.dropDay);
  const targetMeal=targetItem?targetItem.dataset.dropItemMeal:zone.dataset.dropMeal;
  const targetKey=slotKey(targetDay,targetMeal),target=p.slots[targetKey]||[];
  let targetIndex=targetItem?Number(targetItem.dataset.dropItemIndex):target.length;
  const [item]=source.splice(draggedMenuItem.index,1);
  if(item){if(sourceKey===targetKey&&draggedMenuItem.index<targetIndex)targetIndex--;target.splice(Math.max(0,targetIndex),0,item);p.slots[targetKey]=target}
  draggedMenuItem=null;if(item)persist('菜单位置已保存。');else render();
});
document.addEventListener('dragend',()=>{draggedMenuItem=null;document.querySelectorAll('.drag-over,.is-dragging').forEach(el=>el.classList.remove('drag-over','is-dragging'))});
document.addEventListener('submit',async e=>{
  if(cloudBootstrapping){e.preventDefault();showToast('正在校准云端最新数据，请稍候再编辑。','error');return}
  if(e.target.id==='folder-create-form'){e.preventDefault();if(operationBusy)return;const fd=new FormData(e.target),name=fd.get('name').trim();if(!name)return;const folder={id:uid('folder'),name,createdAt:new Date().toISOString()},previous=[...state.folders];state.folders.push(folder);if(!save(state)){state.folders=previous;return showToast('文件夹保存失败，请重试。','error')}folderCreateOpen=false;startFolderId=folder.id;startPlanOpen=false;menuCreateOpen=false;view='start';render();showToast('文件夹创建成功。');return}
  if(e.target.id!=='new-plan-form')return;e.preventDefault();if(operationBusy)return;const form=e.target,fd=new FormData(form),selectedMeals=fd.getAll('meals');if(!selectedMeals.length)return showToast('请至少选择一个餐次。','error');
  const type=fd.get('type'),next=createPlan({name:fd.get('name').trim(),type,days:type==='day'?1:7,people:Number(fd.get('people')),goal:'均衡',selectedMeals});next.folderId=form.dataset.folderId;next.startDate=fd.get('startDate');next.dislike=fd.get('dislike');next.budget=Number(fd.get('budget'))||'';next.maxSpicy=Math.max(0,Math.min(5,Number(form.querySelector('.star-picker[data-name="maxSpicy"]')?.dataset.value||0)));next.cuisines=fd.getAll('cuisines');
  const intent=e.submitter?.value||'order';
  await runBusy(e.submitter,'正在创建...',async()=>{
    const previousPlans=state.plans,previousCurrent=state.currentPlanId;
    state.plans=[...state.plans,next];state.currentPlanId=next.id;
    if(!save(state)){state.plans=previousPlans;state.currentPlanId=previousCurrent;return showToast('菜单保存失败，请释放本地存储空间后重试。','error')}
    orderSelection=[];orderTarget=null;startFolderId=next.folderId;startPlanOpen=intent==='blank';if(intent==='order')startHistory.push({startFolderId:next.folderId,startPlanOpen:true,view:'start'});view=intent==='blank'?'start':'order';render();showToast(intent==='blank'?'空白菜单已创建，可手动添加或智能补全。':'菜单创建成功，请选择菜品。')
  });
});
document.querySelector('#export-data').addEventListener('click',()=>download('家庭菜单完整备份.json',JSON.stringify(state,null,2)));
render();
hydrateFromCloud();
