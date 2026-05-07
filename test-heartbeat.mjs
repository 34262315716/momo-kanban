/**
 * momo-kanban 心跳功能测试脚本
 *
 * 测试 last_activity 字段在 CRUD 全链路上的自动行为：
 * - addTask 时初始化 last_activity = created_at
 * - updateTask 自动 bump last_activity
 * - doTask / doneTask 自动 bump
 * - touchTask 仅更新 last_activity
 * - formatTask 显示停滞标识
 * - schema 迁移幂等
 *
 * 运行: node test-heartbeat.mjs
 * (需要在 extensions/momo-kanban/ 目录下执行)
 */

import Database from "better-sqlite3";
import { KanbanDB } from "./db.js";
import { KanbanManagerV2 } from "./manager-v2.js";
import fs from "node:fs";

const TEST_DB = "/tmp/test-kanban-heartbeat.db";

// ---- Helpers ----
function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✅ ${label}`);
  passed++;
}

function fail(label, detail) {
  console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  failed++;
}

function assert(cond, label) {
  cond ? ok(label) : fail(label);
}

function assertEq(actual, expected, label) {
  actual === expected ? ok(label + ` (=${expected})`)
    : fail(label, `expected ${expected}, got ${actual}`);
}

function assertGt(a, b, label) {
  a > b ? ok(label + ` (${a} > ${b})`)
    : fail(label, `${a} not > ${b}`);
}

function assertLt(a, b, label) {
  a < b ? ok(label + ` (${a} < ${b})`)
    : fail(label, `${a} not < ${b}`);
}

// ---- Setup ----
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
try { fs.unlinkSync(TEST_DB + "-wal"); } catch {}
try { fs.unlinkSync(TEST_DB + "-shm"); } catch {}

let taskId;      // shared across tests
let createdTime; // reference timestamp

// ===============================
console.log("==============================");
console.log("🧪 momo-kanban Heartbeat Tests");
console.log("==============================\n");

// ── 1. Schema & Migration ──
console.log("📋 1. Schema & Migration");
{
  const db = new KanbanDB(TEST_DB);

  const columns = db["db"].pragma("table_info(tasks)");
  assert(columns.some(c => c.name === "last_activity"), "tasks 表含 last_activity 列");

  const indexes = db["db"].pragma("index_list(tasks)");
  assert(indexes.some(i => i.name === "idx_tasks_status_last_activity"),
    "tasks 表含 idx_tasks_status_last_activity 复合索引");

  // 幂等
  db["migrateToV2_2"]();
  assert(true, "migrateToV2_2 第二次调用不抛错");

  db.close();
}

// ── 2. addTask 初始化 last_activity ──
console.log("\n📋 2. addTask 初始化 last_activity");
{
  const db = new KanbanDB(TEST_DB);
  createdTime = Date.now();

  const t = db.addTask({
    title: "测试任务1",
    status: "todo", scope: "test", priority: "normal",
  });

  taskId = t.id;
  assertEq(t.last_activity, t.created_at, "last_activity === created_at");
  assertLt(Math.abs(t.last_activity - createdTime), 200, "last_activity ≈ 当前时间");

  db.close();
}

// ── 3. updateTask 自动 bump ──
console.log("\n📋 3. updateTask 自动 bump last_activity");
{
  const db = new KanbanDB(TEST_DB);
  const t0 = db.getTask(taskId);
  const before = t0.last_activity;

  await delay(10);
  db.updateTask(taskId, { title: "测试任务1-改" });

  const after = db.getTask(taskId).last_activity;
  assertGt(after, before, "updateTask 后 last_activity 增大");

  db.close();
}

// ── 4. updateTask 单字段也 bump ──
console.log("\n📋 4. updateTask 只改 priority 也 bump");
{
  const db = new KanbanDB(TEST_DB);
  const before = db.getTask(taskId).last_activity;

  await delay(10);
  db.updateTask(taskId, { priority: "high" });

  const after = db.getTask(taskId).last_activity;
  assertGt(after, before, "单字段 update 也 bump");

  db.close();
}

// ── 5. rowToTask 映射 ──
console.log("\n📋 5. rowToTask 映射 last_activity");
{
  const db = new KanbanDB(TEST_DB);
  const tasks = db.getTasks({ scope: "test" });
  assert(tasks.length > 0, "能查到测试任务");
  tasks.forEach(t => {
    assert(typeof t.last_activity === "number", `last_activity 是数字 (${t.id})`);
  });
  db.close();
}

// ── 6. Manager: doTask bumps last_activity ──
console.log("\n📋 6. Manager Layer: doTask bumps last_activity");
{
  const mgr = new KanbanManagerV2(TEST_DB, "test", "测试看板",
    { info() {}, warn() {} });

  const r = mgr.addTask({ title: "经理层测试", priority: "normal" });
  assert(r.success, "manager.addTask 成功");
  const id = r.task.id;
  const before = r.task.last_activity;

  await delay(10);
  const doR = mgr.doTask(id);
  assert(doR.success, "manager.doTask 成功");
  assertGt(doR.task.last_activity, before, "doTask 后 last_activity 增大");

  mgr.close();
}

// ── 7. Manager: doneTask bumps last_activity ──
console.log("\n📋 7. Manager Layer: doneTask bumps last_activity");
{
  const mgr = new KanbanManagerV2(TEST_DB, "test", "测试看板",
    { info() {}, warn() {} });

  const tasks = mgr.listTasks({ showAll: true });
  const doing = tasks.find(t => t.status === "doing");
  assert(doing, "存在 doing 任务");

  const before = doing.last_activity;
  await delay(10);
  const r = mgr.doneTask(doing.id);
  assert(r.success, "manager.doneTask 成功");
  assertGt(r.task.last_activity, before, "doneTask 后 last_activity 增大");

  mgr.close();
}

// ── 8. Manager: touchTask ──
console.log("\n📋 8. Manager Layer: touchTask");
{
  const mgr = new KanbanManagerV2(TEST_DB, "test", "测试看板",
    { info() {}, warn() {} });

  // 建一个新任务来做 touch
  const r = mgr.addTask({ title: "touch 测试", priority: "normal" });
  const id = r.task.id;
  const before = r.task.last_activity;

  await delay(10);
  const touchR = mgr.touchTask(id);
  assert(touchR.success, "touchTask 成功");

  const list = mgr.listTasks({ showAll: true });
  const touched = list.find(t => t.id === id);
  assertGt(touched.last_activity, before, "touchTask 后 last_activity 增大");

  // touch 不存在的任务
  const bad = mgr.touchTask("nonexistent");
  assert(!bad.success, "touchTask 不存在返回失败");

  mgr.close();
}

// ── 9. FormatTask 停滞检测 ──
console.log("\n📋 9. FormatTask 停滞检测展示");
{
  const mgr = new KanbanManagerV2(TEST_DB, "test", "测试看板",
    { info() {}, warn() {} });

  const r = mgr.addTask({ title: "已停滞任务", priority: "high" });
  const id = r.task.id;

  await delay(5);
  const doR = mgr.doTask(id);
  assert(doR.success, "停滞测试: doTask 成功");

  // 用 raw SQL 注入旧 last_activity
  {
    const raw = new Database(TEST_DB);
    raw.prepare("UPDATE tasks SET last_activity = ? WHERE id = ?")
      .run(Date.now() - 3 * 60 * 60 * 1000, id);
    raw.close();
  }

  // 通过 manager 重读
  const list = mgr.listTasks({ showAll: true });
  const stalled = list.find(t => t.id === id);
  assert(stalled.status === "doing", "停滞任务仍是 doing");
  assertLt(stalled.last_activity, Date.now() - 2 * 60 * 60 * 1000, "last_activity 在 2h 前");

  // 看板注入文本应含停滞标识
  const board = mgr.getInjectContent(undefined, null);
  assert(board.includes("💤停滞"), "getInjectContent 含 💤停滞");

  mgr.close();
}

// ── 10. FormatTask 不同停滞等级 ──
console.log("\n📋 10. FormatTask 不同停滞等级");
{
  const mgr = new KanbanManagerV2(TEST_DB, "test", "测试看板",
    { info() {}, warn() {} });

  const now = Date.now();

  // 用 raw SQL 创建+注入，避免 doTask 互相覆盖
  const raw = new Database(TEST_DB);

  // 闲置级（45min）
  const id1 = "test_idle_" + Date.now();
  raw.prepare(`INSERT INTO tasks (id, title, status, scope, priority, created_at, started_at, last_activity)
    VALUES (?, ?, 'doing', 'test', 'normal', ?, ?, ?)`)
    .run(id1, "闲置任务", now, now, now - 45 * 60 * 1000);

  // 停滞级（4h）
  const id2 = "test_stalled_" + Date.now();
  raw.prepare(`INSERT INTO tasks (id, title, status, scope, priority, created_at, started_at, last_activity)
    VALUES (?, ?, 'doing', 'test', 'normal', ?, ?, ?)`)
    .run(id2, "停滞任务B", now, now, now - 4 * 60 * 60 * 1000);

  // 长停滞级（12h）
  const id3 = "test_long_stalled_" + Date.now();
  raw.prepare(`INSERT INTO tasks (id, title, status, scope, priority, created_at, started_at, last_activity)
    VALUES (?, ?, 'doing', 'test', 'normal', ?, ?, ?)`)
    .run(id3, "长停滞任务", now, now, now - 12 * 60 * 60 * 1000);

  raw.close();

  const board = mgr.getInjectContent("test", null);
  assert(board.includes("⏸️闲置"), "含 ⏸️闲置 标识 (< 2h)");
  assert(board.includes("💤停滞"), "含 💤停滞 标识 (2h~6h)");
  assert(board.includes("🔴停滞"), "含 🔴停滞 标识 (> 6h)");

  mgr.close();
}

// ── 11. Cleanup ──
console.log("\n📋 11. Cleanup");
{
  // 先关所有连接（用 raw db 确保清理）
  try {
    const raw = new Database(TEST_DB);
    raw.close();
  } catch {}
  try { fs.unlinkSync(TEST_DB); } catch {}
  try { fs.unlinkSync(TEST_DB + "-wal"); } catch {}
  try { fs.unlinkSync(TEST_DB + "-shm"); } catch {}
  assert(!fs.existsSync(TEST_DB), "临时数据库已删除");
}

// ===============================
console.log("\n==============================");
console.log(`🏁 结果: ${passed} 通过, ${failed} 失败`);
console.log("==============================\n");
process.exit(failed > 0 ? 1 : 0);
