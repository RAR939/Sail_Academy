import { ArcRotateCamera, Engine, Scene, Vector3 } from "@babylonjs/core";
import { ShoreEnvironment } from "./world/ShoreEnvironment";
import { AssetLoader } from "./rendering/AssetLoader";
import { Character } from "./rendering/Character";
import { TransformNode } from "@babylonjs/core";
import type { WorldConfig, WorldResponse } from "./world/WorldConfig";
import "./styles/admin.css";

const root = document.querySelector<HTMLDivElement>("#admin")!;
root.innerHTML = `
<header class="top"><div><span class="eyebrow">SAIL ACADEMY / УПРАВЛЕНИЕ</span><h1>Редактор мира</h1><p>Черновик виден только вам. Игроки увидят изменения после сохранения.</p></div><a href="/">← Вернуться в игру</a></header>
<div class="login" id="login"><h2>Доступ администратора</h2><p>Войдите под учётной записью, которой выданы права на сервере.</p><form><input name="username" placeholder="Имя пользователя" autocomplete="username" required><input name="password" type="password" placeholder="Пароль" autocomplete="current-password" required><button>Войти</button></form></div>
<main id="editor" hidden>
  <div class="workspace"><section class="controls"><div class="section-head"><div><span class="eyebrow">ПАРАМЕТРЫ</span><h2>Настройки и объекты</h2></div><span id="dirty" class="badge">Сохранено</span></div>
    <div id="fields" class="fields"></div>
    <div class="object-editor"><label>Объект мира<select id="objects"></select></label><div id="coordinates" class="fields"></div></div>
    <details><summary>Весь файл мира (JSON)</summary><p>Здесь доступны все объекты, материалы, NPC и подписи. Предпросмотр обновляется автоматически после проверки.</p><textarea id="json" spellcheck="false" aria-label="Файл мира JSON"></textarea></details>
    <div class="actions"><button id="save">Сохранить мир</button><button id="discard" class="secondary">Отменить изменения</button></div>
    <p id="status" class="status" role="status"></p>
    <section class="backups"><h3>Резервные копии</h3><p>Создаются автоматически перед сохранением и откатом.</p><select id="backups" aria-label="Резервная копия"></select><div class="actions"><button id="load-backup" class="secondary">Открыть в черновике</button><button id="restore" class="secondary">Откатить мир</button></div></section>
  </section><section class="preview"><div class="preview-bar"><div><span class="eyebrow">ПРЕДПРОСМОТР</span><h2>Береговой клуб</h2></div><span>ЛКМ — вращение · колесо — масштаб</span></div><canvas id="preview-canvas"></canvas></section></div>
</main>`;
const $ = <T extends Element>(selector: string): T => root.querySelector<T>(selector)!;
const login = $<HTMLElement>("#login"), editor = $<HTMLElement>("#editor"), status = $<HTMLElement>("#status");
const json = $<HTMLTextAreaElement>("#json"), dirty = $<HTMLElement>("#dirty"), objects = $<HTMLSelectElement>("#objects"), backups = $<HTMLSelectElement>("#backups");
const canvas = $<HTMLCanvasElement>("#preview-canvas");
let token = sessionStorage.getItem("sail_academy_access_token") ?? "";
let saved: WorldConfig | null = null, revision = "", timer = 0, requestNumber = 0, previewVersion = 0;
let engine: Engine | null = null, preview: Scene | null = null, previewEnvironment: ShoreEnvironment | null = null, previewLoader: AssetLoader | null = null;
let camera: ArcRotateCamera | null = null;
let previewCharacters: Character[] = [];

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init.headers } });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { detail?: unknown };
    const detail = Array.isArray(data.detail) ? data.detail.map((e: { loc?: unknown[]; msg?: string }) => `${e.loc?.join(".")}: ${e.msg}`).join("; ") : data.detail;
    throw new Error(typeof detail === "string" ? detail : `Ошибка ${response.status}`);
  }
  return response.json() as Promise<T>;
}
function showStatus(message: string, error = false): void { status.textContent = message; status.classList.toggle("error", error); }
function parseDraft(): WorldConfig { return JSON.parse(json.value) as WorldConfig; }
function setDraft(world: WorldConfig): void { json.value = JSON.stringify(world, null, 2); syncFields(world); syncObjects(world); markDirty(); schedulePreview(); }
function markDirty(): void {
  const changed = !saved || json.value !== JSON.stringify(saved, null, 2);
  dirty.textContent = changed ? "Есть изменения" : "Сохранено"; dirty.classList.toggle("changed", changed);
}
const fields: Array<["player" | "camera" | "environment", string, string, number]> = [
  ["player", "walkSpeed", "Ходьба, м/с", .1], ["player", "runSpeed", "Бег, м/с", .1], ["player", "acceleration", "Ускорение", 1], ["player", "braking", "Торможение", 1], ["player", "gravity", "Гравитация", 1], ["player", "turnSpeed", "Поворот персонажа", .5],
  ["camera", "distance", "Дистанция камеры", .1], ["camera", "minDistance", "Мин. дистанция", .1], ["camera", "maxDistance", "Макс. дистанция", .1], ["camera", "height", "Высота цели камеры", .1], ["camera", "followSpeed", "Скорость следования", .1], ["camera", "manualDelay", "Пауза после мыши, с", .1],
  ["environment", "fogStart", "Начало тумана", 1], ["environment", "fogEnd", "Конец тумана", 1], ["environment", "lightIntensity", "Освещение", .05],
];
const fieldsRoot = $<HTMLElement>("#fields");
for (const [section, key, title, step] of fields) {
  const label = document.createElement("label"); label.textContent = title;
  const input = document.createElement("input"); input.type = "number"; input.step = String(step); input.dataset.section = section; input.dataset.key = key;
  input.addEventListener("input", () => {
    try { const draft = parseDraft(); if (!Number.isFinite(input.valueAsNumber)) return; (draft[section] as unknown as Record<string, number>)[key] = input.valueAsNumber; json.value = JSON.stringify(draft, null, 2); markDirty(); schedulePreview(); } catch { showStatus("Исправьте JSON перед изменением параметров", true); }
  }); label.append(input); fieldsRoot.append(label);
}
function syncFields(world: WorldConfig): void {
  for (const input of fieldsRoot.querySelectorAll<HTMLInputElement>("input")) {
    const section = input.dataset.section as "player" | "camera" | "environment";
    const values = world[section] as unknown as Record<string, number>;
    input.value = String(values[input.dataset.key!] ?? "");
  }
}
function syncObjects(world: WorldConfig): void {
  const previous = objects.value;
  objects.replaceChildren();
  const addGroup = (title: string, entries: Array<[string, string]>): void => {
    const group = document.createElement("optgroup"); group.label = title;
    for (const [value, text] of entries) { const option = document.createElement("option"); option.value = value; option.textContent = text; group.append(option); }
    objects.append(group);
  };
  addGroup("Объекты", world.boxes.map((box, i) => [`box:${i}`, `${box.name} · ${i + 1}`]));
  addGroup("Цилиндры", world.cylinders.map((item, i) => [`cylinder:${i}`, `${item.name} · ${i + 1}`]));
  addGroup("Персонажи", world.npcs.map((npc, i) => [`npc:${i}`, npc.name]));
  addGroup("Декорации GLB", world.props.map((item, i) => [`prop:${i}`, `${item[0]} · ${i + 1}`]));
  if ([...objects.options].some(o => o.value === previous)) objects.value = previous;
  renderCoordinates(world);
}
function renderCoordinates(world: WorldConfig): void {
  const [kind, rawIndex] = objects.value.split(":"); const index = Number(rawIndex);
  const container = $<HTMLElement>("#coordinates"); container.replaceChildren();
  type Field = [string, number, (draft: WorldConfig, value: number) => void];
  const fields: Field[] = [];
  if (kind === "box" || kind === "cylinder") {
    const item = kind === "box" ? world.boxes[index] : world.cylinders[index];
    if (!item) return;
    ["X", "Y", "Z"].forEach((name, axis) => fields.push([name, item.position[axis]!, (draft, value) => { const obj = kind === "box" ? draft.boxes[index] : draft.cylinders[index]; if (obj) obj.position[axis] = value; }]));
    if (kind === "box") ["Ширина", "Высота", "Глубина"].forEach((name, axis) => fields.push([name, world.boxes[index]!.size[axis]!, (draft, value) => { draft.boxes[index]!.size[axis] = value; }]));
    else { fields.push(["Высота", world.cylinders[index]!.height, (draft, value) => { draft.cylinders[index]!.height = value; }]); fields.push(["Диаметр", world.cylinders[index]!.diameter, (draft, value) => { draft.cylinders[index]!.diameter = value; }]); }
  } else if (kind === "npc") {
    const npc = world.npcs[index]; if (!npc) return;
    fields.push(["X", npc.x, (draft, value) => { draft.npcs[index]!.x = value; }], ["Z", npc.z, (draft, value) => { draft.npcs[index]!.z = value; }]);
  } else if (kind === "prop") {
    const prop = world.props[index]; if (!prop) return;
    fields.push(["X", prop[1], (draft, value) => { draft.props[index]![1] = value; }], ["Z", prop[2], (draft, value) => { draft.props[index]![2] = value; }], ["Масштаб", prop[3], (draft, value) => { draft.props[index]![3] = value; }]);
  }
  for (const [name, value, update] of fields) {
    const label = document.createElement("label"); label.textContent = name;
    const input = document.createElement("input"); input.type = "number"; input.step = "0.1"; input.value = String(value);
    input.addEventListener("input", () => { if (!Number.isFinite(input.valueAsNumber)) return; try { const draft = parseDraft(); update(draft, input.valueAsNumber); json.value = JSON.stringify(draft, null, 2); markDirty(); schedulePreview(); } catch { showStatus("Исправьте JSON", true); } });
    label.append(input); container.append(label);
  }
}
objects.addEventListener("change", () => { try { renderCoordinates(parseDraft()); } catch { /* draft incomplete */ } });
json.addEventListener("input", () => { markDirty(); try { const draft = parseDraft(); syncFields(draft); syncObjects(draft); } catch { /* wait for valid JSON */ } schedulePreview(); });
function schedulePreview(): void {
  window.clearTimeout(timer); const current = ++requestNumber;
  timer = window.setTimeout(() => { void (async () => {
    try {
      const draft = parseDraft();
      const result = await api<{world: WorldConfig}>("/api/admin/world/validate", { method: "POST", body: JSON.stringify(draft) });
      if (current !== requestNumber) return;
      renderPreview(result.world); showStatus("Предпросмотр обновлён. Изменения ещё не сохранены.");
    } catch (error) { if (current === requestNumber) showStatus(error instanceof Error ? error.message : "Проверьте черновик", true); }
  })(); }, 450);
}
function renderPreview(world: WorldConfig): void {
  engine ??= new Engine(canvas, true);
  const previousCamera = camera ? { alpha: camera.alpha, beta: camera.beta, radius: camera.radius, target: camera.target.clone() } : null;
  previewCharacters.forEach(character => character.dispose()); previewCharacters = [];
  previewEnvironment?.dispose(); previewLoader?.dispose(); preview?.dispose();
  const scene = new Scene(engine); preview = scene;
  scene.collisionsEnabled = true;
  const nextCamera = new ArcRotateCamera("admin-camera", previousCamera?.alpha ?? -1.3, previousCamera?.beta ?? 0.9, previousCamera?.radius ?? 55, previousCamera?.target ?? new Vector3(0, 0, 8), scene);
  camera = nextCamera; nextCamera.lowerRadiusLimit = 3; nextCamera.upperRadiusLimit = 150; nextCamera.wheelPrecision = 3; nextCamera.attachControl(canvas, true); scene.activeCamera = nextCamera;
  previewEnvironment = new ShoreEnvironment(scene, world);
  const loader = new AssetLoader(scene); previewLoader = loader;
  const version = ++previewVersion;
  for (const npc of world.npcs) {
    const station = previewEnvironment.stations.get(npc.id)!;
    const anchor = new TransformNode(`preview-npc-${npc.id}`, scene);
    anchor.parent = station.anchor; anchor.position.y = 0.9;
    const character = new Character(scene, loader, anchor, npc.name, npc.role);
    previewCharacters.push(character);
    void character.load(npc.skin).then(() => {
      if (version !== previewVersion) return;
      const meshes = character.getMeshes();
      if (meshes.length) { station.meshes.forEach(mesh => mesh.dispose()); station.meshes = meshes; }
    }).catch(console.warn);
  }
  for (const [path, x, z, scale] of world.props) {
    void loader.spawn(`/assets/glb/${path}.glb`, { name: `preview-${path}-${x}-${z}`, position: new Vector3(x, 0, z), scaling: new Vector3(scale, scale, scale) }).then(asset => { if (version !== previewVersion) asset.dispose(); }).catch(console.warn);
  }
}
async function refreshBackups(): Promise<void> {
  const result = await api<{backups: Array<{id: string}>}>("/api/admin/world/backups"); backups.replaceChildren();
  for (const entry of result.backups) { const option = document.createElement("option"); option.value = entry.id; option.textContent = entry.id; backups.append(option); }
  if (!result.backups.length) { const option = document.createElement("option"); option.value = ""; option.textContent = "Пока нет резервных копий"; backups.append(option); }
}
async function openEditor(): Promise<void> {
  const response = await api<WorldResponse>("/api/admin/world");
  saved = response.world; revision = response.revision; login.hidden = true; editor.hidden = false;
  if (!engine) {
    engine = new Engine(canvas, true);
    engine.runRenderLoop(() => { if (preview && !preview.isDisposed) preview.render(); });
  }
  setDraft(response.world); await refreshBackups();
}
$<HTMLFormElement>("#login form").addEventListener("submit", event => { event.preventDefault(); void (async () => {
  try { const form = new FormData(event.currentTarget as HTMLFormElement); const response = await fetch("/api/auth/login", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:form.get("username"),password:form.get("password")})}); const data = await response.json() as {access_token?: string; detail?: string}; if (!response.ok || !data.access_token) throw new Error(data.detail ?? "Не удалось войти"); token = data.access_token; await openEditor(); }
  catch (error) { alert(error instanceof Error ? error.message : "Ошибка входа"); }
})(); });
$<HTMLButtonElement>("#save").addEventListener("click", () => { void (async () => {
  const button = $<HTMLButtonElement>("#save"); if (button.disabled) return; button.disabled = true;
  try {
    const draftText = json.value, draft = parseDraft();
    const result = await api<{revision:string}>("/api/admin/world", {method:"PUT",body:JSON.stringify({revision,world:draft})});
    revision = result.revision;
    const current = await api<WorldResponse>("/api/admin/world"); saved = current.world; revision = current.revision;
    if (json.value === draftText) setDraft(current.world); else markDirty();
    await refreshBackups(); showStatus(json.value === JSON.stringify(saved, null, 2) ? "Мир сохранён. Игроки получат обновление автоматически." : "Мир сохранён. Новые изменения остались в черновике.");
  } catch (error) { showStatus(error instanceof Error ? error.message : "Не удалось сохранить", true); }
  finally { button.disabled = false; }
})(); });
$<HTMLButtonElement>("#discard").addEventListener("click", () => { if (saved && confirm("Отменить несохранённые изменения?")) { setDraft(saved); showStatus("Черновик восстановлен до сохранённой версии."); } });
$<HTMLButtonElement>("#load-backup").addEventListener("click", () => { void (async () => { try { if (!backups.value) return; const result = await api<{world:WorldConfig}>(`/api/admin/world/backups/${encodeURIComponent(backups.value)}`); setDraft(result.world); showStatus("Копия открыта в черновике. Опубликованный мир не изменён."); } catch(error) { showStatus(error instanceof Error ? error.message : "Ошибка",true); } })(); });
$<HTMLButtonElement>("#restore").addEventListener("click", () => { void (async () => { try { if (!backups.value || !confirm("Откатить опубликованный мир к этой копии? Текущая версия попадёт в резервную копию, а несохранённый черновик будет заменён.")) return; await api("/api/admin/world/restore", {method:"POST",body:JSON.stringify({revision,backup:backups.value})}); const current=await api<WorldResponse>("/api/admin/world"); saved=current.world;revision=current.revision;setDraft(current.world);await refreshBackups();showStatus("Мир восстановлен из резервной копии."); } catch(error) { showStatus(error instanceof Error ? error.message : "Ошибка отката",true); } })(); });
window.addEventListener("resize", () => engine?.resize());
window.addEventListener("beforeunload", event => { if (saved && json.value !== JSON.stringify(saved, null, 2)) event.preventDefault(); });
if (token) void openEditor().catch(() => { login.hidden = false; editor.hidden = true; });
