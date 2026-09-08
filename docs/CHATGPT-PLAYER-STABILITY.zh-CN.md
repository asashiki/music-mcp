# ChatGPT 播放器闪烁：0.2.1 修复

修复位于 `agent/chatgpt-mcp-apps-compat`，播放器资源为 `ui://music-mcp/player-v8.html`。需要更新 **music-mcp** 容器；只更新 mcp-switch 不会替换上游播放器。

## 确认的代码缺陷

0.2 的 `openai:set_globals` 监听器不区分主题、高度和歌曲变化。每次通知都重新读取 `toolOutput`、销毁音频、清空 root 并重建播放器。同一份结果也可能从标准 bridge 再到达一次。CSS 每次挂载都从透明开始淡入，因而重复通知既会打断播放，也会反复闪现。

复现测试实际执行旧版构建产物：首次数据后连续发送 25 轮主题、重复 globals 和标准结果通知，创建了 76 个音频对象。这个实验确认了代码缺陷；没有取得用户会话的帧日志，因此尚不能断言这是线上故障的唯一原因。

另有三个问题：高度通知未等待初始化、未去重并回报了宿主控制的宽度；主题只依赖系统设置；所有 play() 失败都误报为自动播放受限。

## 改动

- 按规范化后的歌曲数据去重，同一结果保留音频对象、播放位置、按钮焦点和当前歌单位置。收到标准结果后，旧兼容通道不再回写旧数据。
- 主题和 locale 独立更新，使用宿主提供的 CSS 变量。只在实际高度改变时报告高度，等待握手完成；旧宿主可用 `notifyIntrinsicHeight`。
- 移除入场动画、组件自身边框/阴影、READY 标签与装饰动效。由宿主提供一层外框，播放器铺满可用宽度。单曲只显示一个播放按钮；歌单保留切歌，最多显示当前歌曲附近五行，不在卡片内滚动。
- 进度条改为可键盘操作的 range，切歌取消过期歌词请求。播放失败在组件中显示，区别浏览器播放权限与音频不可用。
- 实现标准 `ui/resource-teardown` 请求与响应；关闭时停止媒体、观察器和待处理请求。

宿主外框由 ChatGPT 决定；插件样式只能控制 iframe 内部，不能承诺外框完全消失。

## 已验证与未验证

`npm test`：12 项通过，其中新增 5 项执行真实打包后的播放器 JavaScript，在可观测的模拟 DOM/媒体环境中检查生命周期。旧 bundle 上这五项均失败；修复后全部通过。另有类型检查、服务器构建、MCP/认证/Range 回归。

**这些测试不包含真实浏览器音频解码，也不等价于 ChatGPT 播放验收。** 本轮云浏览器拒绝本地 URL 和文件 URL；没有浏览器截图或实际播放录像。MCP2 搜索与播放工具返回了歌曲数据，但本轮环境请求 canary 的 `/diagnostics/mcp-app` 返回 502；不能由工具成功推断资源和媒体可达，也不能据此判定所有用户都遇到 502。

可重复的浏览器测试文件：

```bash
npm run preview:player
# 在浏览器打开 dist/player-preview.html
```

文件使用自制的 8 秒测试音调与模拟宿主，不请求音乐平台。点播放后，点“重放 50 次通知”，检查音频不中断、`sameAudio` 保持 true、进度不归零、高度通知不无限增长。再检查 320px、720px、深浅色、歌单切歌。这个文件由构建产物生成，不是另一套播放器。

## 部署与最终验收

1. 在现有 canary 中检出本分支的最新提交并重新构建 music-mcp；保持当前域名、密钥和媒体代理配置。
2. `/healthz` 确认 `version=0.2.1`；`/diagnostics/mcp-app` 确认 URI 为 `player-v8.html`。先确认公网响应成功。
3. 在 Switch 对 Music 上游重新发现，使 tools/list 的新 UI URI 生效；再刷新 ChatGPT 的插件工具与资源缓存，在新对话重新调用。
4. 用同一首歌对比直连 Music 与经 Switch 转发：稳定显示、点击播放、暂停、拖进度、继续对话后保持播放、切歌、主题变化、窄屏。
5. 音频不响时单独检查返回的 `audioUrl`、浏览器网络错误、CSP 和 Range 请求。重新生成卡片不能修复失效媒体源。

完成第 4 步并保留录像后，才能将状态写成“ChatGPT 播放已验证”。

依据：[OpenAI UI 接入](https://developers.openai.com/plugins/build/chatgpt-ui)、[UI 指南](https://developers.openai.com/plugins/concepts/ui-guidelines)、[MCP Apps 规范](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)。
