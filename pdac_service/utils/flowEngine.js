class FlowEngine {
  constructor(template, context = {}) {
    this.template = template || { nodes: [], transitions: [] };
    this.nodes = this.template.nodes || [];
    this.transitions = this.template.transitions || [];
    // 建立 nodeId -> node 快速索引
    this.nodeMap = new Map((this.nodes || []).map(n => [n.id, n]));

    // 上下文（可选，用于条件判断）
    this.context = context;

    // 运行时状态
    this.completedNodes = new Set();   // 已完成的节点 ID
    this.pendingTasks = [];           // 当前待办节点 ID
    this.finished = false;            // 是否已完成流程
  }

  /** 获取节点 */
  getNode(id) {
    return this.nodeMap.get(id);
  }

  /** 获取开始节点 */
  getStartNode() {
    return this.nodes.find(n => n.type === 'start');
  }

  /** 获取 fromId 的所有出边 */
  getNextTransitions(fromId) {
    return this.transitions.filter(t => t.from === fromId);
  }

  /** 获取 fromId 的所有后继节点 */
  getNextNodes(fromId) {
    return this.getNextTransitions(fromId).map(t => this.getNode(t.to)).filter(Boolean);
  }

  /** 获取 nodeId 的所有前驱节点 */
  getIncomingNodes(nodeId) {
    return this.transitions
      .filter(t => t.to === nodeId)
      .map(t => this.getNode(t.from))
      .filter(Boolean);
  }

  /** 条件判断 */
  evaluateCondition(conditionExpression, context = {}) {
    if (!conditionExpression || conditionExpression.trim() === '') return false;
    try {
      const keys = Object.keys(context || {});
      const values = Object.values(context || {});
      const fn = new Function(...keys, `return (${conditionExpression});`);
      return !!fn(...values);
    } catch (e) {
      console.error('condition eval failed:', conditionExpression, e);
      return false;
    }
  }

  /** 恢复运行状态 */
  restoreState({ completed = [], pending = [], context = {}, finished = false } = {}) {
    this.completedNodes = new Set(completed || []);
    this.pendingTasks = (pending || []).slice();
    this.context = Object.assign({}, this.context, context || {});
    this.finished = !!finished;
  }

  /** 判断流程是否已完成 */
  isFinished() {
    // 如果显式标记 finished=true
    if (this.finished) return true;
    // 没有 pending 任务 且 所有 end 节点都完成
    return this.pendingTasks.length === 0 && this._allEndNodesReached();
  }

  /** 判断所有 end 节点是否已完成 */
  _allEndNodesReached() {
    const endNodes = this.nodes.filter(n => n.type === 'end');
    if (endNodes.length === 0) return false; // 没有 end 节点，不能算完成
    return endNodes.every(n => this.completedNodes.has(n.id));
  }
}

module.exports = FlowEngine;
