'use strict';
const {EXPRESSION_KEYS,SKIN_KEYS,POSE_KEYS}=require('./host-policy.cjs');
const labels={glasses:'眼镜',blush:'害羞',angry:'生气',sleep:'睡觉',surprise:'惊讶',dizzy:'晕',wink:'Wink',cry:'伤心',heart:'爱心眼',smile:'微笑',cat:'猫猫形态',idle:'日常待机',megaphone:'听我说呀！',cake:'吃蛋糕',tea:'喝奶茶',awkward:'囧'};
const percent=scale=>`${Number((scale*100).toPrecision(6)).toLocaleString('zh-CN',{maximumFractionDigits:5})}%`;
function trayTemplate({settings,appearance,action,updateSettings,recover,resize,quit}){
  const toggle=(key,label)=>({label,type:'checkbox',checked:settings[key],click:item=>updateSettings({[key]:item.checked})});
  return [
    {label:'显示 / 恢复操作 (Ctrl+Alt+P)',click:()=>recover()},
    {label:'恢复 100% 大小并找回桌宠',click:()=>recover(true)},
    {type:'separator'},
    {label:'表情（空格 + 数字）',submenu:Object.entries(EXPRESSION_KEYS).map(([key,id])=>({label:`${labels[id]}  Space+${key}`,type:'checkbox',checked:appearance.expression===id,click:()=>action({type:'expression',id})}))},
    {label:'装扮开关（F1–F2）',submenu:Object.entries(SKIN_KEYS).map(([key,id])=>({label:`${labels[id]}  Space+${key}`,type:'checkbox',checked:appearance[id],click:()=>action({type:'toggle-skin',id})}))},
    {label:'动作四选一（F3–F6）',submenu:Object.entries(POSE_KEYS).map(([key,id])=>({label:`${labels[id]}  Space+${key}`,type:'radio',checked:appearance.pose===id,click:()=>action({type:'pose',id})}))},
    {label:'全部重置 (Space+Backspace)',click:()=>action('reset')},
    {type:'separator'},
    toggle('eyeTracking','目光跟随鼠标'),toggle('hairMotion','头发、衣摆与腿部摆动'),
    toggle('alwaysOnTop','始终置顶'),toggle('clickThrough','点击穿透（托盘或 Ctrl+Alt+P 恢复）'),
    toggle('legacyHotkeys','Space 全局组合键'),toggle('alternateHotkeys','备用 Ctrl+Alt 全局组合键'),
    {label:`大小：${percent(settings.scale)}`,submenu:[
      {label:'按住人物上的鼠标右键 + 滚轮调整',enabled:false},
      {type:'separator'},
      ...[.01,.05,.1,.25,.5,1,2,5,10].map(scale=>({label:percent(scale),type:'radio',checked:Math.abs(settings.scale-scale)<1e-10,click:()=>resize(scale)})),
      {type:'separator'},
      {label:'放大 10%',click:()=>resize(settings.scale*1.1)},
      {label:'缩小 10%',click:()=>resize(settings.scale/1.1)},
      {label:'放大一倍',click:()=>resize(settings.scale*2)},
      {label:'缩小一半',click:()=>resize(settings.scale/2)},
    ]},
    {type:'separator'},
    {label:'退出桌宠',click:quit},
  ];
}
module.exports={trayTemplate,percent};
