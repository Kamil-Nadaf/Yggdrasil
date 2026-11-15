export type DiffOp = { t: " " | "+" | "-"; text: string };
export type DiffHunk = { oldStart: number; newStart: number; ops: DiffOp[] };

/** Line diff of a -> b (trim common prefix/suffix, LCS on the middle). */
export function diffLines(a: string, b: string): DiffOp[] {
  const x = a.split("\n");
  const y = b.split("\n");
  let s = 0;
  while (s < x.length && s < y.length && x[s] === y[s]) s++;
  let ex = x.length;
  let ey = y.length;
  while (ex > s && ey > s && x[ex - 1] === y[ey - 1]) {
    ex--;
    ey--;
  }
  const ops: DiffOp[] = [];
  for (let i = 0; i < s; i++) ops.push({ t: " ", text: x[i] });
  const mx = x.slice(s, ex);
  const my = y.slice(s, ey);
  const n = mx.length;
  const m = my.length;
  if (n * m > 4_000_000) {
    mx.forEach((l) => ops.push({ t: "-", text: l }));
    my.forEach((l) => ops.push({ t: "+", text: l }));
  } else {
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] =
          mx[i] === my[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (mx[i] === my[j]) {
        ops.push({ t: " ", text: mx[i] });
        i++;
        j++;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
        ops.push({ t: "-", text: mx[i++] });
      } else {
        ops.push({ t: "+", text: my[j++] });
      }
    }
    while (i < n) ops.push({ t: "-", text: mx[i++] });
    while (j < m) ops.push({ t: "+", text: my[j++] });
  }
  for (let i = ex; i < x.length; i++) ops.push({ t: " ", text: x[i] });
  return ops;
}

/** Group a diff into hunks with `ctx` lines of context. */
export function toHunks(ops: DiffOp[], ctx = 3): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let oldLn = 1;
  let newLn = 1;
  const meta = ops.map((o) => {
    const m = { o: oldLn, n: newLn };
    if (o.t !== "+") oldLn++;
    if (o.t !== "-") newLn++;
    return m;
  });
  const changed = ops.map((o, i) => (o.t !== " " ? i : -1)).filter((i) => i >= 0);
  let k = 0;
  while (k < changed.length) {
    let start = Math.max(0, changed[k] - ctx);
    let end = Math.min(ops.length - 1, changed[k] + ctx);
    k++;
    while (k < changed.length && changed[k] - ctx <= end + 1) {
      end = Math.min(ops.length - 1, changed[k] + ctx);
      k++;
    }
    hunks.push({ oldStart: meta[start].o, newStart: meta[start].n, ops: ops.slice(start, end + 1) });
    start = end;
  }
  return hunks;
}

export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const o of ops) {
    if (o.t === "+") added++;
    else if (o.t === "-") removed++;
  }
  return { added, removed };
}
