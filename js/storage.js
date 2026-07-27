const KEY = 'family-menu-planner-v2';
const LEGACY_KEY = 'family-menu-planner-v1';

export const categories = ['肉菜', '蔬菜', '主食', '汤饮', '甜品', '超大菜', '其他'];
export const meals = ['早餐', '午餐', '晚餐'];
export const healthTags = ['高蛋白', '蔬菜', '全谷物', '清淡', '低油', '低糖'];
export const cuisineOptions = ['中餐', '日料', '意大利菜', '法餐', '韩餐', '东南亚菜', '西餐', '其他'];
export const servingOptions = [1, 2, 4, 8];
export const healthStandards = {
  '均衡': { meat:0.30, vegetable:0.40, staple:0.25, other:0.05 },
  '清淡': { meat:0.20, vegetable:0.55, staple:0.25, other:0.00 },
  '高蛋白': { meat:0.50, vegetable:0.30, staple:0.15, other:0.05 },
  '低糖': { meat:0.40, vegetable:0.45, staple:0.10, other:0.05 }
};

const samples = [
  ['红烧肉','肉菜','猪肉,五花肉','高蛋白','中餐','午餐,晚餐'],
  ['青椒肉丝','肉菜','猪肉,青椒','高蛋白','中餐','午餐,晚餐'],
  ['清蒸鲈鱼','肉菜','鱼类,鲈鱼','高蛋白,清淡,低油','中餐','午餐,晚餐'],
  ['番茄炖牛腩','肉菜','牛肉,番茄','高蛋白','西餐','午餐,晚餐'],
  ['宫保鸡丁','肉菜','鸡肉,花生','高蛋白','中餐','午餐,晚餐'],
  ['麻婆豆腐','肉菜','豆制品,猪肉','高蛋白','中餐','午餐,晚餐'],
  ['清炒西兰花','蔬菜','西兰花','蔬菜,清淡,低油','中餐','午餐,晚餐'],
  ['蒜蓉菠菜','蔬菜','菠菜','蔬菜,清淡,低油','中餐','早餐,午餐,晚餐'],
  ['地三鲜','蔬菜','茄子,土豆,青椒','蔬菜','中餐','午餐,晚餐'],
  ['凉拌木耳','蔬菜','木耳,黄瓜','蔬菜,清淡','中餐','午餐,晚餐'],
  ['杂粮饭','主食','糙米,全谷物','全谷物,清淡','中餐','午餐,晚餐'],
  ['番茄鸡蛋面','主食','面条,鸡蛋,番茄','高蛋白','中餐','早餐,午餐,晚餐'],
  ['小米粥','主食','小米,全谷物','全谷物,清淡','中餐','早餐'],
  ['玉米排骨汤','汤饮','猪肉,玉米','高蛋白,清淡','中餐','午餐,晚餐'],
  ['冬瓜虾皮汤','汤饮','冬瓜,虾皮','蔬菜,清淡,低油','中餐','午餐,晚餐'],
  ['红豆小圆子','甜品','红豆,糯米','低糖','中餐','午餐,晚餐'],
];
const samplePrices = [24,18,32,38,22,13,9,7,12,8,5,10,4,18,8,9];

const makeDish = (row, index) => ({
  id: `sample-${index}`, name: row[0], category: row[1],
  ingredients: row[2].split(','), healthTags: row[3].split(','),
  cuisine: row[4], meals: row[5].split(','),
  servingOptions: [...servingOptions], favorite: [0,2,6].includes(index),
  image: '', price: samplePrices[index], spicyLevel: [0,2,0,0,3,4,0,0,1,1,0,0,0,0,0,0][index] || 0
});

export const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
export const isoToday = () => new Date().toISOString().slice(0, 10);

export function createPlan({ name = '新菜单计划', type = 'week', days, people = 4, goal = '均衡', selectedMeals } = {}) {
  const dayCount = Number(days || (type === 'day' ? 1 : 7));
  return {
    id: uid('plan'), folderId: '', name, type, startDate: isoToday(), days: dayCount,
    people: Number(people), meals: selectedMeals || ['早餐','午餐','晚餐'],
    goal, dislike: '', budget:'', cuisines:[], maxSpicy:5, autoFillMenu:null, slots: {}, createdAt: new Date().toISOString()
  };
}

export const defaultState = () => {
  const folder = { id:uid('folder'), name:'家庭菜单', createdAt:new Date().toISOString() };
  const plan = createPlan({ name: '第一周家庭菜单' });
  plan.folderId = folder.id;
  return {
    dishes: samples.map(makeDish),
    folders: [folder],
    plans: [plan],
    currentPlanId: plan.id,
    settings: { people: 4, days: 7, meals: ['早餐','午餐','晚餐'], goal: '均衡', dislike: '' }
  };
};

function migrateDish(d) {
  const oldTags = Array.isArray(d.healthTags) ? d.healthTags : (Array.isArray(d.tags) ? d.tags : []);
  const oldPeople = Array.isArray(d.servingOptions) ? d.servingOptions.map(Number) : servingOptions;
  const sampleIndex = String(d.id || '').startsWith('sample-') ? Number(String(d.id).slice(7)) : -1;
  return {
    id: d.id || uid('dish'), name: d.name || '未命名菜品',
    category: categories.includes(d.category) ? d.category : '其他',
    ingredients: Array.isArray(d.ingredients) ? d.ingredients : [],
    healthTags: oldTags.filter(tag => healthTags.includes(tag)),
    cuisine: cuisineOptions.includes(d.cuisine) ? d.cuisine : '中餐',
    meals: Array.isArray(d.meals) && d.meals.length ? d.meals.filter(meal => meals.includes(meal)) : ['午餐','晚餐'],
    servingOptions: oldPeople.filter(n => servingOptions.includes(n)).length
      ? oldPeople.filter(n => servingOptions.includes(n)) : [...servingOptions],
    favorite: Boolean(d.favorite), image: d.image || '',
    price: Math.max(0, Number(d.price ?? d.cost ?? samplePrices[sampleIndex] ?? 0) || 0),
    spicyLevel: Math.max(0, Math.min(5, Number(d.spicyLevel)||0)),
    description: d.description || '',
    instructions: d.instructions || '',
    nutrition: d.nutrition || '',
    notes: d.notes || ''
  };
}

function migrateLegacy(legacy) {
  const state = defaultState();
  state.dishes = (legacy.dishes || state.dishes).map(migrateDish);
  const old = legacy.plan;
  if (old && Object.keys(old.slots || {}).length) {
    const plan = createPlan({
      name: '迁移的菜单计划', days: legacy.settings?.days,
      people: legacy.settings?.people, goal: legacy.settings?.goal,
      selectedMeals: legacy.settings?.meals
    });
    plan.folderId = state.folders[0].id;
    plan.slots = Object.fromEntries(Object.entries(old.slots).map(([key, items]) => [
      key, items.map(item => ({ dishId:item.dishId, quantity:Number(item.quantity || 1), locked:Boolean(item.locked) }))
    ]));
    state.plans = [plan];
    state.currentPlanId = plan.id;
  }
  return state;
}

export function load() {
  try {
    const current = JSON.parse(localStorage.getItem(KEY));
    if (current) {
      const fallback = defaultState();
      const folders = Array.isArray(current.folders) && current.folders.length ? current.folders : fallback.folders;
      const plans = (Array.isArray(current.plans) && current.plans.length ? current.plans : fallback.plans)
        .map(plan => ({
          ...plan,
          budget:Number(plan.budget)||'',
          cuisines:Array.isArray(plan.cuisines)?plan.cuisines.filter(x=>cuisineOptions.includes(x)):[],
          maxSpicy:Math.max(0,Math.min(5,Number(plan.maxSpicy ?? 5))),
          autoFillMenu:typeof plan.autoFillMenu==='boolean'?plan.autoFillMenu:null,
          folderId: folders.some(folder => folder.id === plan.folderId) ? plan.folderId : folders[0].id
        }));
      return {
        ...fallback, ...current,
        folders,
        dishes: (current.dishes || fallback.dishes).map(migrateDish),
        plans,
        currentPlanId: plans.some(p => p.id === current.currentPlanId) ? current.currentPlanId : plans[0].id
      };
    }
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
    return legacy ? migrateLegacy(legacy) : defaultState();
  } catch {
    return defaultState();
  }
}

export const save = state => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error('保存本地数据失败', error);
    return false;
  }
};
