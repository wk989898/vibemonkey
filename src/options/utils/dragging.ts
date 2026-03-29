import { isTouch } from "@/common/ui";

const SCRIPT = ".script";
const SCROLL_GAP = 50;
// px per one 60fps frame so the max is ~1200px per second (~one page)
const MAX_SCROLL_SPEED = 20;
const ONE_FRAME_MS = 16;
// touch-and-hold duration in ms before recognizing dragstart (needed to allow fling-scrolling)
const LONGPRESS_DELAY = 500;

const eventNames = isTouch
  ? { start: "touchstart", move: "touchmove", end: "touchend" }
  : { start: "dragstart", move: "mousemove", end: "mouseup" };
// inserting a scroll blocker as the first element of the list to avoid changing the list's
// style/class as it would be slooooooooooow due to style recalc on all of its children
const noScroll =
  isTouch &&
  Object.assign(document.createElement("div"), {
    className: "dragging-noscroll",
  });
const eventsToSuppress = ["scroll", "mouseenter", "mouseleave"];
const PASSIVE_LISTENER: AddEventListenerOptions = { passive: true };

let dragged;
let elements;
let height;
let index;
let lastIndex;
let longPressEvent;
let longPressTimer;
let offsetX;
let offsetY;
/** @type {HTMLElement} */
let original;
let parent;
let parentOnDrop;
let scrollEdgeTop;
let scrollEdgeBottom;
let scrollTimer;
let scrollSpeed;
let scrollTimestamp;
let xyCache;

export default function toggleDragging(listEl, moveScript, state) {
  parent = listEl;
  parentOnDrop = moveScript;
  if (state) {
    parent.addEventListener(eventNames.start, isTouch ? onTouchStart : onDragStart, isTouch ? PASSIVE_LISTENER : false);
    if (!isTouch) {
      parent.addEventListener("dblclick", onDblClick, true);
      parent.addEventListener("mousedown", onMouseDown, true);
    }
  } else {
    parent.removeEventListener(eventNames.start, isTouch ? onTouchStart : onDragStart, false);
    if (!isTouch) {
      parent.removeEventListener("dblclick", onDblClick, true);
      parent.removeEventListener("mousedown", onMouseDown, true);
      onMouseUp();
    }
  }
}

function onDblClick(evt) {
  const selection = getSelection();
  const el = evt.target.closest(".script-name");
  if (el) {
    selection.removeAllRanges();
    selection.selectAllChildren(el);
  }
}

/** @param {MouseEvent} e */
function onMouseDown(e) {
  if (!e.altKey && scriptFromEvent(e)) original.draggable = true;
  parent.addEventListener("mouseup", onMouseUp, true);
}

function onMouseUp() {
  if (original) original.draggable = false;
  parent.removeEventListener("mouseup", onMouseUp, true);
}

function onDrop() {
  parentOnDrop(index, lastIndex);
}

function onTouchStart(e) {
  if (!scriptFromEvent(e)) return;
  longPressEvent = e;
  longPressTimer = setTimeout(onTouchMoveDetect, LONGPRESS_DELAY, "timer");
  addEventListener(eventNames.move, onTouchMoveDetect, PASSIVE_LISTENER);
  addEventListener(eventNames.end, onTouchEndDetect, PASSIVE_LISTENER);
}

function onTouchMoveDetect(e) {
  onTouchEndDetect();
  if (e === "timer") {
    onDragStart.call(original, longPressEvent);
    if (IS_FIREFOX && parentCanScroll()) {
      // FF bug workaround: prevent the script list container from scrolling on drag
      parent.scrollTop += 1;
      parent.scrollTop -= 1;
    }
  }
}

function onTouchEndDetect() {
  clearTimeout(longPressTimer);
  removeEventListener(eventNames.move, onTouchMoveDetect, false);
  removeEventListener(eventNames.end, onTouchEndDetect, false);
}

function onDragStart(e) {
  if (!scriptFromEvent(e)) return;
  if (e.cancelable) e.preventDefault();
  const { clientX: x, clientY: y } = e.touches?.[0] || e;
  const rect = original.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  dragged = original.cloneNode(true);
  elements = Array.prototype.filter.call(parent.children, (el) => el.style.display !== "none");
  index = elements.indexOf(original);
  lastIndex = index;
  elements.splice(index, 1);
  height = rect.height;
  offsetX = x - rect.left;
  offsetY = y - rect.top;
  scrollEdgeTop = parentRect.top + SCROLL_GAP;
  scrollEdgeBottom = parentRect.bottom - SCROLL_GAP;
  xyCache = {};
  original.classList.add("dragging-placeholder");
  dragged.classList.add("dragging");
  dragged.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
  dragged.style.width = `${rect.width}px`;
  parent.appendChild(dragged);
  if (isTouch) parent.insertAdjacentElement("afterBegin", noScroll);
  addEventListener(eventNames.move, onDragMouseMove, isTouch && PASSIVE_LISTENER);
  addEventListener(eventNames.end, onDragMouseUp, isTouch && PASSIVE_LISTENER);
}

function onDragMouseMove(e) {
  const { clientX: x, clientY: y, target } = e.touches?.[0] || e;
  let moved;
  const hovered = isTouch ? scriptFromPoint(x, y) : target.closest?.(SCRIPT);
  // FF bug: despite placeholder having `pointer-events:none` it's still reported in `target`
  if (hovered && hovered !== original) {
    const rect = hovered.getBoundingClientRect();
    const isDown = y > rect.top + rect.height / 2;
    moved = original !== hovered[`${isDown ? "next" : "previous"}ElementSibling`];
    if (moved) {
      hovered.insertAdjacentElement(isDown ? "afterEnd" : "beforeBegin", original);
      animate(elements.indexOf(hovered) + isDown);
    }
  }
  dragged.style.transform = `translate(${x - offsetX}px, ${y - offsetY}px)`;
  if (maybeScroll(y) || moved) xyCache = {};
}

function onDragMouseUp() {
  removeEventListener(eventNames.move, onDragMouseMove, false);
  removeEventListener(eventNames.end, onDragMouseUp, false);
  stopScrolling();
  dragged.remove();
  if (isTouch) noScroll.remove();
  original.classList.remove("dragging-placeholder");
  onDrop();
}

function animate(hoveredIndex) {
  const delta = lastIndex < hoveredIndex ? height : -height;
  const group = elements.slice(
    ...(lastIndex < hoveredIndex ? [lastIndex, hoveredIndex] : [hoveredIndex, lastIndex]),
  );
  group.forEach((el) => {
    el.style.transition = "none";
    el.style.transform = `translateY(${delta}px)`;
  });
  setTimeout(() =>
    group.forEach(({ style }) => {
      style.removeProperty("transition");
      style.removeProperty("transform");
    }),
  );
  lastIndex = hoveredIndex;
}

function parentCanScroll() {
  return parent.scrollHeight > parent.clientHeight;
}

function maybeScroll(y) {
  const delta =
    parentCanScroll() &&
    Math.min(1, Math.max(0, y - scrollEdgeBottom, scrollEdgeTop - y) / SCROLL_GAP);
  if (!delta && scrollTimer) stopScrolling();
  if (delta && !scrollTimer) startScrolling();
  scrollSpeed = delta && (y > scrollEdgeBottom ? 1 : -1) * ((1 + delta * MAX_SCROLL_SPEED) | 0);
  scrollTimestamp = performance.now();
  return !!delta;
}

function doScroll() {
  // normalize scroll speed: on slower devices the step will be bigger
  const ts = performance.now();
  const distance = (scrollSpeed * (ts - scrollTimestamp)) / ONE_FRAME_MS;
  parent.scrollTop += distance;
  scrollTimestamp = ts;
}

function startScrolling() {
  scrollTimer = setInterval(doScroll, ONE_FRAME_MS);
  eventsToSuppress.forEach((name) => addEventListener(name, stopPropagation, true));
}

function stopScrolling() {
  eventsToSuppress.forEach((name) => removeEventListener(name, stopPropagation, true));
  if (scrollTimer) clearInterval(scrollTimer);
  scrollTimer = 0;
}

// primary goal: don't update Vueleton/tooltip while drag-scrolling
function stopPropagation(e) {
  e.stopPropagation();
}

// touch devices are usually slooooow so touchmove causes jank due to frequent elementFromPoint
function scriptFromPoint(x, y) {
  const key = `${x}:${y}`;
  const el = xyCache[key] || (xyCache[key] = document.elementFromPoint(x, y)?.closest(SCRIPT));
  return el;
}

function scriptFromEvent(e) {
  original = e.target.closest(SCRIPT);
  return original;
}
