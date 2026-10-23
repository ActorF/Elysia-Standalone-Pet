'use strict';
function trayTemplate({ openSettings, quit }) {
  return [
    { label: '设置', click: openSettings },
    { label: '退出', click: quit },
  ];
}
module.exports = { trayTemplate };
