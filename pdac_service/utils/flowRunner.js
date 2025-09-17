// FlowRunner.js
const FlowEngine = require('./flowEngine');

class FlowRunner {
  /**
   * engine: FlowEngine instance
   * opts: { context, persistHook }
   * persistHook: async function(state){...} // called whenever state changes
   */
  constructor(engine, opts = {}) {
    if (!(engine instanceof FlowEngine)) throw new Error('engine must be FlowEngine');
    this.engine = engine;
    this.context = opts.context || {};
    this.persistHook = opts.persistHook || (async () => { });
    // 状态
    this.pendingTasks = []; // [{ nodeId, name, role, type }]
    this.completedNodes = new Set(); // nodeId
    this.finished = false;
    this.instanceId = opts.instanceId || null; // optional
    this.activeBranches = new Set();
  }

  // 恢复状态（如果从DB加载）
  async restoreState({ completed = [], pending = [], context = {}, finished = false } = {}) {
    this.completedNodes = new Set(completed || []);
    this.pendingTasks = (pending || []).slice();
    this.context = Object.assign({}, this.context, context || {});
    this.finished = !!finished;
    console.log('[restoreState] completed:', Array.from(this.completedNodes), 'pending:', this.pendingTasks.map(t => t.nodeId), 'context:', this.context, 'finished:', this.finished);
  }

  // 启动流程：从 start 节点推进
  async start() {
    const start = this.engine.getStartNode();
    if (!start) throw new Error('start node not found');
    console.log('[start] Start 节点:', start);
    await this._moveNext(start.id);
    await this._persist();
    console.log('[start] 生成初始待办任务对象数组:', this.pendingTasks.map(t => t.nodeId));
  }

  // 完成待办任务
  async completeTask(nodeId, { completedBy = null, contextUpdate = {} } = {}) {
    // 更新 context
    if (contextUpdate && typeof contextUpdate === 'object') {
      Object.assign(this.context, contextUpdate);
      console.log('[completeTask] context 更新:', this.context);
    }

    // 移除 pendingTasks
    const idx = this.pendingTasks.findIndex(t => t.nodeId === nodeId);
    if (idx >= 0) {
      this.pendingTasks.splice(idx, 1);
    } else {
      console.log('[completeTask] 非待办任务完成标记:', nodeId);
    }

    // 标记节点完成（累积，不覆盖）
    this.completedNodes.add(nodeId);

    // 推进下游节点
    const nextNodes = this.engine.getNextNodes(nodeId);
    for (const nextNode of nextNodes) {
      await this._handleNode(nextNode);
    }

    await this._persist();
  }

  // 内部推进逻辑：遍历当前节点的 outgoing transitions
  async _moveNext(fromNodeId) {
    const transitions = this.engine.getNextTransitions(fromNodeId);
    console.log('[moveNext] 从节点', fromNodeId, '的 transitions:', transitions.map(t => `${t.from}->${t.to}`));
    for (const t of transitions) {
      // 条件判断（优先检查 transition 上的 conditionExpression）
      if (t.conditionExpression) {
        const ok = this.engine.evaluateCondition(t.conditionExpression, this.context);
        console.log('[moveNext] transition', t.from, '->', t.to, 'condition:', t.conditionExpression, 'result:', ok);
        if (!ok) continue;
      }

      const target = this.engine.getNode(t.to);
      if (!target) {
        console.warn('[moveNext] 找不到目标节点:', t.to);
        continue;
      }
      if (t.branch) this.activeBranches.add(t.branch);
      await this._handleNode(target, t.branch);
    }
  }

  // _handleNode 修改：task/approval 完成后尝试推进下游
  async _handleNode(node) {
    if (!node) return;
    if (this.completedNodes.has(node.id)) return;

    // 检查 joinMode
    const incoming = this.engine.getIncomingNodes(node.id);
    const joinMode = node.joinMode || 'all';
    if (incoming.length > 0 && joinMode === 'all') {
      const allDone = incoming.every(n => this.completedNodes.has(n.id));
      if (!allDone) {
        console.log('[handleNode] 节点等待其他前驱完成:', node.id, 'incoming:', incoming.map(n => n.id));
        return;
      }
    }

    switch (node.type) {
      case 'task':
      case 'approval':
        if (!this.pendingTasks.some(t => t.nodeId === node.id)) {
          this.pendingTasks.push({
            nodeId: node.id,
            name: node.name,
            role: node.role,
            type: node.type
          });
          console.log('[handleNode] 加入待办任务:', node.id);
        }
        break;

      case 'parallel':
        this.completedNodes.add(node.id);
        const nextNodes = this.engine.getNextNodes(node.id);
        for (const nextNode of nextNodes) {
          await this._handleNode(nextNode);
        }
        break;

      case 'condition':
        this.completedNodes.add(node.id);
        await this._moveNext(node.id);
        break;

      case 'end':
        this.completedNodes.add(node.id);
        this.finished = this._checkFinished();
        break;

      case 'start':
        await this._moveNext(node.id);
        if (branch) this.activeBranches.add(branch);
        this.completedNodes.add(node.id);
        break;

      default:
        await this._moveNext(node.id);
    }
  }

  _checkFinished() {
    if (this.pendingTasks.length > 0) return false;

    for (const branch of this.activeBranches) {
      const ends = this.engine.nodes.filter(n => n.type === 'end' && n.branch === branch);
      if (!ends.every(n => this.completedNodes.has(n.id))) return false;
    }
    return true;
  }

  getPendingTasks() {
    return this.pendingTasks.slice();
  }

  // 持久化 hook
  async _persist() {
    console.log('[persist] 状态持久化:', {
      instanceId: this.instanceId,
      completed: Array.from(this.completedNodes),
      pending: this.pendingTasks.map(t => t.nodeId),
      context: this.context,
      finished: this.finished
    });
    return this.persistHook({
      instanceId: this.instanceId,
      completed: Array.from(this.completedNodes),
      pending: this.pendingTasks,
      context: this.context,
      finished: this.finished
    });
  }
}

module.exports = FlowRunner;
