/**
 * 20261127pan修改：从物品 / 装备 / 技能 / 怪物 / NPC 编辑器直接改名称。
 *
 * 名称真正存放在 String.wz（按 ID 索引），而各编辑器展示的是 Item.wz
 * 等属性文件，所以过去必须切到字符串页翻节点。这里复用已有的
 * /api/string/entry 与 /api/string/write：读回该 ID 的全部可写字段，
 * 在一个独立窗口里展示、确认后一次写入。
 *
 * 选择「弹窗 + 显式保存」而不是「列表行内直接改」的原因：
 *  1. 名称常常伴随 desc / func 字段，内联输入框只能看到一个，容易漏改；
 *  2. 新建条目需要选目录（装备的 Eqp 分类、地图的 Region），后端会自动判断，
 *     但用户应能在写入前看到将要落在哪个 image；
 *  3. 写入走 UndoService.Batch，误改可 Ctrl+Z 撤销，但显式按钮能挡住手滑。
 */

import { api } from './api.js';
import { el, toast, toastError, modal } from './ui.js';
import { icon } from './icons.js';

/** 每个 kind 可写的字段，顺序与服务端 StringEditService.Kinds 一致。 */
const FIELDS = {
  item: ['name', 'desc'],
  mob: ['name'],
  skill: ['name', 'desc'],
  npc: ['name', 'func'],
  map: ['mapName', 'streetName'],
};

const FIELD_LABELS = {
  name: '名称',
  desc: '说明',
  func: '职业 / 身份',
  mapName: '地图名称',
  streetName: '街道名称',
};

const PLACEHOLDERS = {
  name: '输入显示名称',
  desc: '输入说明文字（可留空）',
  func: '如：新手指导',
  mapName: '输入地图名称',
  streetName: '输入街道名称',
};

// StringEditService.Scalar() 把「子节点容器」描述成 "N entries"。
// 那不是文本，写回去会把容器换成字符串，所以只读展示。
const CONTAINER_TEXT = /^\d+\s+entries$/i;

const KIND_LABELS = {
  item: '物品',
  mob: '怪物',
  skill: '技能',
  npc: 'NPC',
  map: '地图',
};

/**
 * 打开名称编辑窗口。
 *
 * @param {object}   opts
 * @param {string}   opts.kind     item | mob | skill | npc | map
 * @param {number}   opts.id       该实体的 ID
 * @param {object}   opts.app      应用实例，用于 markDirty()
 * @param {string}  [opts.label]   标题里的中文称呼，如「装备」
 * @param {boolean} [opts.enabled] String.wz 是否已打开；false 时只提示
 * @param {function} [opts.onSaved] 写入成功后回调 (entry, result)
 */
export async function openNameEditor({ kind, id, app, label, enabled = true, onSaved }) {
  if (!enabled) {
    toast('请先在文件列表打开 String.wz，再修改名称。', 'warning', {
      title: '名称暂不可编辑',
    });
    return;
  }

  let entry;
  try {
    entry = await api.stringEntry(kind, id);
  } catch (error) {
    toastError(error, '读取名称失败');
    return;
  }

  const original = entry.fields || {};
  const fields = FIELDS[kind] ||
    (Object.keys(original).length ? Object.keys(original) : ['name']);
  const inputs = {};
  const locked = new Set();
  const fieldRows = [];

  for (const field of fields) {
    const value = original[field] ?? '';
    const isContainer = CONTAINER_TEXT.test(value);
    if (isContainer) locked.add(field);

    const control = field === 'desc'
      ? el('textarea', {
          class: 'ne-input', rows: 3, spellcheck: 'false',
          placeholder: PLACEHOLDERS[field] || '',
          value: isContainer ? '' : value,
          disabled: isContainer,
        })
      : el('input', {
          type: 'text', class: 'ne-input', spellcheck: 'false',
          placeholder: PLACEHOLDERS[field] || '',
          value: isContainer ? '' : value,
          disabled: isContainer,
        });
    inputs[field] = control;

    fieldRows.push(el('label', { class: 'ne-field' },
      el('span', { class: 'ne-label', text: FIELD_LABELS[field] || field }),
      control,
      isContainer
        ? el('span', { class: 'ne-hint', text: '这是子节点的摘要，不能当作文字覆盖；请在资源管理器中编辑。' })
        : null));
  }

  const status = entry.present
    ? el('div', { class: 'ne-status', 'data-kind': 'exists' },
        el('span', { class: 'ne-dot' }),
        `String.wz 中已有此条目 · ${entry.image || ''}${entry.group ? ` / ${entry.group}` : ''}`)
    : el('div', { class: 'ne-status', 'data-kind': 'new' },
        el('span', { class: 'ne-dot' }),
        `尚无名称条目 · 保存时将在 ${entry.image || 'String.wz'} 中新建`);

  const body = el('div', { class: 'ne-body' },
    status,
    entry.path ? el('div', { class: 'ne-path', text: entry.path }) : null,
    el('div', { class: 'ne-fields' }, fieldRows),
    el('p', { class: 'ne-note',
      text: '修改的是 String.wz 里的文字。写入后会标记为未保存，按 Ctrl+S（或点顶部保存按钮）才会落盘。' }));

  modal({
    title: `修改${label || KIND_LABELS[kind] || ''}名称 · ID ${id}`,
    subtitle: '字段与字符串编辑器一致；只提交有变化的项',
    width: 'min(92vw, 560px)',
    body,
    actions: [
      { label: '取消' },
      {
        label: '写入名称',
        class: 'btn-primary',
        closes: false,
        run: async (close) => {
          const changes = {};
          for (const field of fields) {
            if (locked.has(field)) continue;
            const next = inputs[field].value;
            const prev = original[field] ?? '';
            if (next !== prev) changes[field] = next;
          }
          if (!Object.keys(changes).length) {
            toast('名称没有变化。', 'info');
            close();
            return;
          }

          try {
            const result = await api.stringWrite({ kind, id, ...changes });
            const skipped = (result.changes || []).filter((c) => c.skipped);
            if (skipped.length && !result.applied) {
              toast(skipped.map((c) => c.reason).filter(Boolean).join('；') || '未写入任何字段。',
                'warning', { title: '写入被跳过' });
              return;
            }
            app?.markDirty?.();
            if (skipped.length) {
              toast(`已写入 ${result.applied} 项，${skipped.length} 项被跳过。`, 'warning', {
                title: '名称部分写入',
              });
            } else {
              toast('名称已更新，记得保存项目。', 'info', { title: '写入成功' });
            }
            onSaved?.(result.entry, result);
            close();
          } catch (error) {
            toastError(error, '写入名称失败');
          }
        },
      },
    ],
    onOpen: () => {
      inputs[fields[0]]?.focus();
      inputs[fields[0]]?.select?.();
    },
  });
}

/** 供列表行 / 详情头使用的小按钮。 */
export function nameEditButton({ kind, id, label, app, enabled, onSaved, tip }) {
  return el('button', {
    class: 'btn btn-sm btn-icon ne-edit-btn',
    'data-tip': tip || `修改${label || '名称'}`,
    'aria-label': tip || `修改${label || '名称'}`,
    onclick: (event) => {
      event.stopPropagation();
      openNameEditor({ kind, id, label, app, enabled, onSaved });
    },
  }, icon('edit', { size: 14 }));
}

/* ============================================================
   20261127pan修改：数据里存 key、文字在 String.wz 的字段

   技能的 hs（h1 / h2…）与 NPC 对话行（n0 / d1…）都属于这一类：
   属性节点里只有键，真正的话术在 String.wz。这类字段不能用
   /api/string/entry 那套固定字段接口，改走通用节点 API。
   ============================================================ */

/**
 * 编辑 String.wz 里一个指定的文本节点。
 *
 * @param {string}   opts.path     String.wz 节点的完整 session 路径
 * @param {object}   opts.app      用于 markDirty()
 * @param {function} [opts.onSaved] 写入成功后回调 (text, button)
 * @param {string}  [opts.note]    额外说明（如“可能被多个等级共用”）
 */
export async function openStringNodeEditor({ path, title, subtitle, app, onSaved, note }) {
  let node;
  try {
    node = await api.node(path);
  } catch (error) {
    if (error?.status === 404) {
      toast('String.wz 中还没有这个文本节点，请先在字符串编辑器或资源管理器里创建。',
        'warning', { title: '找不到字符串节点' });
    } else {
      toastError(error, '读取字符串节点失败');
    }
    return;
  }

  if (!node?.editable) {
    toast('这个节点不是可直接编辑的文字。', 'warning', { title: '无法编辑' });
    return;
  }

  const current = node.value ?? '';
  const input = el('textarea', {
    class: 'ne-input', rows: 3, spellcheck: 'false', value: current,
  });

  const body = el('div', { class: 'ne-body' },
    el('div', { class: 'ne-status', 'data-kind': 'exists' },
      el('span', { class: 'ne-dot' }), 'String.wz 文本节点'),
    el('div', { class: 'ne-path', text: path }),
    el('label', { class: 'ne-field' },
      el('span', { class: 'ne-label', text: '文本内容' }), input),
    note ? el('p', { class: 'ne-note', text: note }) : null,
    el('p', { class: 'ne-note', text: '写入后会标记为未保存，按 Ctrl+S（或点顶部保存按钮）才会落盘。' }));

  modal({
    title: title || '编辑字符串',
    subtitle: subtitle || path,
    width: 'min(92vw, 560px)',
    body,
    actions: [
      { label: '取消' },
      {
        label: '写入文本',
        class: 'btn-primary',
        closes: false,
        run: async (close) => {
          const next = input.value;
          if (next === current) { toast('内容没有变化。', 'info'); close(); return; }
          try {
            await api.setValue(path, next);
            app?.markDirty?.();
            onSaved?.(next);
            close();
            toast('字符串已更新，记得保存项目。', 'info', { title: '写入成功' });
          } catch (error) {
            toastError(error, '写入字符串失败');
          }
        },
      },
    ],
    onOpen: () => { input.focus(); input.select(); },
  });
}

/**
 * 打开字符串节点编辑器的小按钮。
 *
 * path 可以是现成的字符串，也可以是异步函数——技能的 hs 要先按 ID 查到
 * String.wz 里技能条目的路径，再拼上 h1 / h2。
 */
export function stringNodeEditButton({ path, resolvePath, label, app, enabled = true, onSaved, tip, note }) {
  const button = el('button', {
    class: 'btn btn-sm btn-icon ne-edit-btn',
    'data-tip': tip || `编辑字符串${label ? ` ${label}` : ''}`,
    'aria-label': tip || `编辑字符串${label ? ` ${label}` : ''}`,
    onclick: async (event) => {
      event.stopPropagation();
      if (!enabled) {
        toast('请先在文件列表打开 String.wz，才能修改字符串。', 'warning', {
          title: '字符串暂不可编辑',
        });
        return;
      }
      try {
        const target = typeof resolvePath === 'function' ? await resolvePath() : path;
        if (!target) { toast('找不到对应的字符串节点。', 'warning'); return; }
        await openStringNodeEditor({
          path: target,
          title: `编辑字符串${label ? ` · ${label}` : ''}`,
          app,
          onSaved: (text) => onSaved?.(text, button),
          note,
        });
      } catch (error) {
        toastError(error, '定位字符串节点失败');
      }
    },
  }, icon('type', { size: 14 }));
  return button;
}
