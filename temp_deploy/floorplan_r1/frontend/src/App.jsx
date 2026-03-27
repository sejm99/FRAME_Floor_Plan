import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  Plus, Trash2, RotateCw, RefreshCw, Ruler, Lock, Unlock,
  FileDown, Maximize2, Box, Minus, Settings, Undo2, FileSpreadsheet, Target
} from 'lucide-react';

// ─── Constants ───
const FIELD_WIDTH_UM  = 24500;
const FIELD_HEIGHT_UM = 32000;
const SCREEN_SCALE    = 40; // 1px = 40µm
const SNAP_DRAG_UM    = 400;
const SNAP_DROP_UM    = 600;

const uid   = () => `c_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function chipDim(c) { return c.rot === 90 ? { w: c.h, h: c.w } : { w: c.w, h: c.h }; }

function recalcCollisions(arr, sx = 0, sy = 0) {
  const bad = new Set();
  for (let i = 0; i < arr.length; i++)
    for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      const da = chipDim(a), db = chipDim(b);
      // Check collision including scribe line margins
      if (a.x < b.x + db.w + sx && a.x + da.w + sx > b.x && 
          a.y < b.y + db.h + sy && a.y + da.h + sy > b.y)
        bad.add(a.id), bad.add(b.id);
    }
  return arr.map(c => ({ ...c, colliding: bad.has(c.id) }));
}

// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  // ── React state ──
  const [chips,       setChips]       = useState([]);
  const [selIds,      setSelIds]       = useState([]);
  const [fieldSize,   setFieldSize]    = useState({ w: FIELD_WIDTH_UM,  h: FIELD_HEIGHT_UM });
  const [fieldInput,  setFieldInput]   = useState({ w: String(FIELD_WIDTH_UM), h: String(FIELD_HEIGHT_UM) });
  const [scribe,      setScribe]       = useState({ x: 80, y: 80 });
  const [scribeInput, setScribeInput]  = useState({ x:'80', y:'80' });
  const [chipInput,   setChipInput]    = useState({ w:'5000', h:'3000', count:'1' });
  const [zoom,        setZoom]         = useState(1.0);
  const [offset,      setOffset]       = useState({ x: 80, y: 80 });
  const [measuring,   setMeasuring]    = useState(false);
  const [measSel,     setMeasSel]      = useState([]);
  const [backup,      setBackup]       = useState(null);
  const [editName,    setEditName]     = useState('');
  const [snapping,    setSnapping]     = useState(null);
  const [toast,       setToast]        = useState(null);
  const [coordMode,   setCoordMode]    = useState('bl'); // 'bl' (Bottom-Left) or 'fc' (Frame-Center)

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ── Stable refs ──
  const containerRef = useRef(null);
  const stageRef     = useRef(null);

  // Single drag-state object ref
  const DS = useRef({
    // chip drag
    chipActive: false,
    chipIds:    [],
    startPositions: [], // { id, x, y }
    startX: 0, startY: 0,
    dragStarted: false,
    // pan
    panActive: false,
    panSX: 0, panSY: 0,
    panOX: 0, panOY: 0,
  });

  // Mirrors for global listeners
  const chipsRef     = useRef(chips);
  const selIdsRef    = useRef(selIds);
  const scribeRef    = useRef(scribe);
  const fieldRef     = useRef(fieldSize);
  const zoomRef      = useRef(zoom);
  const offsetRef    = useRef(offset);
  const measuringRef = useRef(measuring);

  useEffect(() => { chipsRef.current    = chips;     }, [chips]);
  useEffect(() => { selIdsRef.current   = selIds;    }, [selIds]);
  useEffect(() => { scribeRef.current   = scribe;    }, [scribe]);
  useEffect(() => { fieldRef.current    = fieldSize; }, [fieldSize]);
  useEffect(() => { zoomRef.current     = zoom;      }, [zoom]);
  useEffect(() => { offsetRef.current   = offset;    }, [offset]);
  useEffect(() => { measuringRef.current= measuring; }, [measuring]);

  // ─── Global pointer handlers — mounted ONCE ───────────────────────────────
  useEffect(() => {
    function onPointerMove(e) {
      const d = DS.current;
      const scale = SCREEN_SCALE / zoomRef.current;

      // ── Chip drag ──
      if (d.chipActive && d.chipIds.length > 0) {
        const dxPx = e.clientX - d.startX;
        const dyPx = e.clientY - d.startY;

        const dxUm =  dxPx * scale;
        const dyUm = -dyPx * scale;

        const sx = scribeRef.current.x, sy = scribeRef.current.y;
        const fw = fieldRef.current.w,  fh = fieldRef.current.h;
        const ids = d.chipIds;

        setChips(prev => {
          const next = prev.map(c => {
            const start = d.startPositions.find(p => p.id === c.id);
            if (!start || c.locked) return c;
            
            const { w, h } = chipDim(c);
            let nx = clamp(start.x + dxUm, sx, fw - w - sx);
            let ny = clamp(start.y + dyUm, sy, fh - h - sy);

            // 1. Sticky Snap Phase
            let bestX = nx;
            let minDistX = SNAP_DRAG_UM;
            let bestY = ny;
            let minDistY = SNAP_DRAG_UM;

            for (const o of prev) {
              if (o.id === c.id || ids.includes(o.id)) continue;
              const { w: ow, h: oh } = chipDim(o);
              
              // X snapping logic
              const yOverlap = (ny < o.y + oh + sy) && (ny + h > o.y - sy);
              if (yOverlap) {
                const dRight = Math.abs(nx - (o.x + ow + sx));
                if (dRight < minDistX) { bestX = o.x + ow + sx; minDistX = dRight; }
                const dLeft = Math.abs(nx + w - (o.x - sx));
                if (dLeft < minDistX) { bestX = o.x - w - sx; minDistX = dLeft; }
              }
              
              // Y snapping logic
              const xOverlap = (nx < o.x + ow + sx) && (nx + w > o.x - sx);
              if (xOverlap) {
                const dTop = Math.abs(ny - (o.y + oh + sy));
                if (dTop < minDistY) { bestY = o.y + oh + sy; minDistY = dTop; }
                const dBot = Math.abs(ny + h - (o.y - sy));
                if (dBot < minDistY) { bestY = o.y - h - sy; minDistY = dBot; }
              }
            }
            nx = bestX;
            ny = bestY;

            return { ...c, x: nx, y: ny };
          });
          return recalcCollisions(next, scribeRef.current.x, scribeRef.current.y);
        });
        return;
      }

      // ── Canvas pan ──
      if (d.panActive) {
        const nx = d.panOX + (e.clientX - d.panSX);
        const ny = d.panOY + (e.clientY - d.panSY);
        setOffset({ x: nx, y: ny });
        offsetRef.current = { x: nx, y: ny };
      }
    }

    function onPointerUp(e) {
      const d = DS.current;
      if (d.chipActive) {
        const ids = [...d.chipIds];
        const sx = scribeRef.current.x, sy = scribeRef.current.y;
        
        setChips(prev => {
          const next = prev.map(cs => {
            if (!ids.includes(cs.id) || cs.locked) return cs;
            let { x, y } = cs;
            const { w, h } = chipDim(cs);
            let snapped = false;

            // 1. Final Snap Selection
            for (const o of prev) {
              if (o.id === cs.id || ids.includes(o.id)) continue;
              const { w: ow, h: oh } = chipDim(o);
              
              // X snap if aligned in Y
              if (y < o.y + oh + sy && y + h > o.y - sy) {
                if (Math.abs(x - (o.x + ow + sx)) < SNAP_DROP_UM) { x = o.x + ow + sx; snapped = true; }
                else if (Math.abs(x + w - (o.x - sx)) < SNAP_DROP_UM) { x = o.x - w - sx; snapped = true; }
              }
              // Y snap if aligned in X
              if (x < o.x + ow + sx && x + w > o.x - sx) {
                if (Math.abs(y - (o.y + oh + sy)) < SNAP_DROP_UM) { y = o.y + oh + sy; snapped = true; }
                else if (Math.abs(y + h - (o.y - sy)) < SNAP_DROP_UM) { y = o.y - h - sy; snapped = true; }
              }
              // Align edges
              if (Math.abs(x - o.x) < SNAP_DROP_UM) { x = o.x; snapped = true; }
              if (Math.abs(y - o.y) < SNAP_DROP_UM) { y = o.y; snapped = true; }
            }

            // 2. Guaranteed Scribe Spacing (Overlap Prevention)
            for (const o of prev) {
              if (o.id === cs.id || ids.includes(o.id)) continue;
              const { w: ow, h: oh } = chipDim(o);
              if (x < o.x + ow + sx && x + w > o.x - sx && 
                  y < o.y + oh + sy && y + h > o.y - sy) {
                const dx1 = Math.abs(x - (o.x + ow + sx));
                const dx2 = Math.abs(x + w - (o.x - sx));
                const dy1 = Math.abs(y - (o.y + oh + sy));
                const dy2 = Math.abs(y + h - (o.y - sy));
                const mv = Math.min(dx1, dx2, dy1, dy2);
                if (mv === dx1) x = o.x + ow + sx;
                else if (mv === dx2) x = o.x - w - sx;
                else if (mv === dy1) y = o.y + oh + sy;
                else if (mv === dy2) y = o.y - h - sy;
                snapped = true;
              }
            }

            if (snapped) setSnapping(cs.id);
            return { ...cs, x, y };
          });
          return recalcCollisions(next, scribeRef.current.x, scribeRef.current.y);
        });
        
        d.chipActive = false;
        d.chipIds = [];
        d.startPositions = [];
        d.dragStarted = false;
        setTimeout(() => setSnapping(null), 400);
      }
      d.panActive = false;
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup',   onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup',   onPointerUp);
    };
  }, []);

  // ─── Chip down handler ────────────────────────────────────────────────────
  const onChipDown = useCallback((id, e) => {
    e.stopPropagation();
    e.preventDefault();

    if (measuringRef.current) {
      setMeasSel(prev => {
        const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id].slice(-2);
        return next;
      });
      return;
    }

    const chip = chipsRef.current.find(c => c.id === id);
    if (chip?.locked) return;

    // Pointer Capture — ensure move events are tracked even outside the div
    e.currentTarget.setPointerCapture(e.pointerId);

    let next;
    if (e.shiftKey) {
      next = selIdsRef.current.includes(id)
        ? selIdsRef.current.filter(x => x !== id)
        : [...selIdsRef.current, id];
    } else {
      next = selIdsRef.current.includes(id) ? selIdsRef.current : [id];
    }
    
    setSelIds(next);
    selIdsRef.current = next;
    setEditName(chip?.name || '');

    // Initialize DRAG state in ref
    DS.current.chipActive = true;
    DS.current.chipIds    = next;
    DS.current.startX     = e.clientX;
    DS.current.startY     = e.clientY;
    DS.current.startPositions = chipsRef.current
      .filter(c => next.includes(c.id))
      .map(c => ({ id: c.id, x: c.x, y: c.y }));
  }, []);

  // ─── Canvas pan handler ───────────────────────────────────────────────────
  const onCanvasDown = useCallback((e) => {
    if (DS.current.chipActive) return;
    DS.current.panActive = true;
    DS.current.panSX     = e.clientX;
    DS.current.panSY     = e.clientY;
    DS.current.panOX     = offsetRef.current.x;
    DS.current.panOY     = offsetRef.current.y;
  }, []);

  // ─── Zoom (wheel) ─────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      if (!selIdsRef.current.length) return;
      const rect  = el.getBoundingClientRect();
      const mx    = e.clientX - rect.left;
      const my    = e.clientY - rect.top;
      const oldZ  = zoomRef.current;
      const newZ  = clamp(oldZ * (e.deltaY > 0 ? 0.9 : 1.1), 0.1, 8.0);
      const ratio = newZ / oldZ;
      const ox = offsetRef.current.x, oy = offsetRef.current.y;
      const nx = mx - (mx - ox) * ratio;
      const ny = my - (my - oy) * ratio;
      setZoom(newZ);
      setOffset({ x: nx, y: ny });
      zoomRef.current   = newZ;
      offsetRef.current = { x: nx, y: ny };
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // ─── Reset view ───────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const cw = el.clientWidth, ch = el.clientHeight;
    const fw0 = fieldRef.current.w / SCREEN_SCALE;
    const fh0 = fieldRef.current.h / SCREEN_SCALE;
    
    // Fit to screen with margins
    const z = clamp(Math.min((cw - 160) / fw0, (ch - 160) / fh0), 0.1, 1.0);
    const nx = (cw - fw0 * z) / 2;
    const ny = (ch - fh0 * z) / 2;
    
    setZoom(z);
    zoomRef.current = z;
    setOffset({ x: nx, y: ny });
    offsetRef.current = { x: nx, y: ny };
  }, []);

  // Auto-center on resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let timer;
    const obs = new ResizeObserver(() => {
      // Debounce to prevent jitter
      clearTimeout(timer);
      timer = setTimeout(() => {
        const cw = el.clientWidth, ch = el.clientHeight;
        const fw0 = fieldRef.current.w / SCREEN_SCALE;
        const fh0 = fieldRef.current.h / SCREEN_SCALE;
        const z = zoomRef.current;
        
        // Keep it centered on resize
        const nx = (cw - fw0 * z) / 2;
        const ny = (ch - fh0 * z) / 2;
        
        setOffset({ x: nx, y: ny });
        offsetRef.current = { x: nx, y: ny };
      }, 50);
    });
    
    obs.observe(el);
    setTimeout(handleReset, 100); // Initial fit
    return () => obs.disconnect();
  }, [handleReset]);

  const addChips = useCallback(() => {
    const w = parseFloat(chipInput.w), h = parseFloat(chipInput.h);
    const count = parseInt(chipInput.count, 10);
    if (isNaN(w)||isNaN(h)||isNaN(count)||w<=0||h<=0||count<=0) return;
    const sx = scribe.x, sy = scribe.y;
    const fw = fieldSize.w, fh = fieldSize.h;

    setChips(prev => {
      let cur = [...prev];
      const added = [];
      
      for (let i = 0; i < count; i++) {
        let placed = false;
        // Search gap-by-gap for the tightest possible spot
        outer: for (let y = sy; y + h + sy <= fh; y += 10) { 
          let x = sx;
          while (x + w + sx <= fw) {
            const conflict = cur.find(c => {
              const d = chipDim(c);
              return (x < c.x + d.w + sx && x + w + sx > c.x &&
                      y < c.y + d.h + sy && y + h + sy > c.y);
            });
            
            if (!conflict) {
              const nameId = cur.length + 1;
              const newChip = { id:uid(), name:`C-${nameId}`, w, h, x, y, rot:0, locked:false, colliding:false };
              added.push(newChip);
              cur.push(newChip);
              placed = true;
              break outer;
            } else {
              // Jump exactly to the edge of the conflicting chip to maintain tight spacing
              const cd = chipDim(conflict);
              x = conflict.x + cd.w + sx;
            }
          }
        }
        if (!placed) {
          alert(`Could not find space for chip ${i+1}. Field is full or gaps are too small.`);
          break;
        }
      }
      
      if (added.length) { 
        const lastId = added[added.length-1].id;
        setSelIds([lastId]); 
        selIdsRef.current = [lastId];
      }
      return recalcCollisions(cur, sx, sy);
    });
  }, [chipInput, scribe, fieldSize]);

  const deleteSelected = useCallback(() => {
    setChips(prev => recalcCollisions(prev.filter(c => !selIds.includes(c.id)), scribeRef.current.x, scribeRef.current.y));
    setSelIds([]); selIdsRef.current = [];
  }, [selIds]);

  const toggleLock = useCallback((id) => {
    const targets = id ? [id] : selIds;
    setChips(prev => prev.map(c => targets.includes(c.id) ? {...c, locked:!c.locked} : c));
  }, [selIds]);

  const rotateSelected = useCallback(() => {
    setChips(prev => {
      const next = prev.map(c => {
        if (!selIds.includes(c.id)||c.locked) return c;
        const newRot = c.rot===90 ? 0 : 90;
        const { w, h } = newRot===90 ? {w:c.h,h:c.w} : {w:c.w,h:c.h};
        return { ...c, rot:newRot, x:clamp(c.x,scribe.x,fieldSize.w-w-scribe.x), y:clamp(c.y,scribe.y,fieldSize.h-h-scribe.y) };
      });
      return recalcCollisions(next, scribe.x, scribe.y);
    });
  }, [selIds, scribe, fieldSize]);

  const resetWorkspace = useCallback(() => {
    if (!confirm('All chips will be removed. Continue?')) return;
    setChips([]); setSelIds([]); setBackup(null); selIdsRef.current=[];
  }, []);

  const optimizeField = useCallback(() => {
    if (!chips.length) { alert('No chips!'); return; }
    const sx = parseFloat(scribeInput.x)||scribe.x, sy = parseFloat(scribeInput.y)||scribe.y;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    chips.forEach(c => { const {w,h}=chipDim(c); minX=Math.min(minX,c.x); minY=Math.min(minY,c.y); maxX=Math.max(maxX,c.x+w); maxY=Math.max(maxY,c.y+h); });
    setBackup({ chips: chips.map(c=>({...c})), fieldSize: {...fieldSize} });
    const dx=sx-minX, dy=sy-minY, nw=(maxX-minX)+2*sx, nh=(maxY-minY)+2*sy;
    setChips(prev => recalcCollisions(prev.map(c=>({...c,x:c.x+dx,y:c.y+dy})), sx, sy));
    setFieldSize({w:nw,h:nh}); setFieldInput({w:nw.toFixed(1),h:nh.toFixed(1)});
    fieldRef.current={w:nw,h:nh};
    alert(`Optimized to ${nw.toFixed(0)} × ${nh.toFixed(0)} µm`);
  }, [chips, scribe, scribeInput, fieldSize]);

  const undoOptimize = useCallback(() => {
    if (!backup) return;
    setChips(backup.chips); setFieldSize(backup.fieldSize);
    setFieldInput({w:String(backup.fieldSize.w),h:String(backup.fieldSize.h)});
    fieldRef.current=backup.fieldSize; setBackup(null);
  }, [backup]);

  const exportGDS = useCallback(async () => {
    if (!chips.length) { alert('No chips!'); return; }
    try {
      const res = await axios.post('/api/export/gds', {
        chips: chips.map(c=>({id:c.id,name:c.name,width:c.w,height:c.h,x:c.x,y:c.y,rotation:c.rot})),
        field_width: fieldSize.w, field_height: fieldSize.h,
      }, { responseType:'blob' });
      const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([res.data]));
      a.download='mask_floorplan.gds'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch(e) { alert('GDS Export Failed: '+(e?.message||e)); }
  }, [chips,fieldSize]);

  useEffect(() => {
    if (chips.length > 0) {
      // Periodic check or startup check if needed
    }
  }, [chips]);

  const handleNameChange = useCallback((val) => {
    setEditName(val);
    setChips(prev => prev.map(c => selIds.includes(c.id) ? { ...c, name: val } : c));
  }, [selIds]);

  const applyFieldSize = useCallback(() => {
    const w = parseFloat(fieldInput.w), h = parseFloat(fieldInput.h);
    if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
      setFieldSize({ w, h });
      fieldRef.current = { w, h };
    }
  }, [fieldInput]);

  const onScribeChange = (k, v) => {
    setScribeInput(p => ({ ...p, [k]: v }));
    const n = parseFloat(v);
    if (!isNaN(n) && n >= 0) {
      setScribe(p => ({ ...p, [k]: n }));
      scribeRef.current = { ...scribeRef.current, [k]: n };
    }
  };

  const exportCSV = useCallback(() => {
    const sel = chips.filter(c => selIds.includes(c.id));
    if (!sel.length) { alert('Select chips first!'); return; }
    
    showToast('선택된 칩들의 좌표 정보만 추출됩니다.');
    
    const fw = fieldSize.w, fh = fieldSize.h;
    const cx = fw / 2, cy = fh / 2;
    
    // --- Table 1: Base (Bottom-Left) ---
    const rows = [['Base (Bottom-Left)'], ['Chip Name', 'Width', 'Height', 'X1', 'Y1', 'X2', 'Y2', 'Rotation']];
    rows.push(['FRAME', fw, fh, 0, 0, fw, fh, 0]);
    sel.forEach(c => {
      const { w, h } = chipDim(c);
      rows.push([c.name, c.w, c.h, Math.round(c.x), Math.round(c.y), Math.round(c.x + w), Math.round(c.y + h), c.rot]);
    });

    rows.push([]); // Empty row as divider

    // --- Table 2: Base (Frame Center) ---
    rows.push(['Base (Frame Center)']);
    rows.push(['Chip Name', 'Width', 'Height', 'X1', 'Y1', 'X2', 'Y2', 'Rotation']);
    rows.push(['FRAME', fw, fh, Math.round(-cx), Math.round(-cy), Math.round(cx), Math.round(cy), 0]);
    sel.forEach(c => {
      const { w, h } = chipDim(c);
      rows.push([
        c.name, c.w, c.h, 
        Math.round(c.x - cx), Math.round(c.y - cy), 
        Math.round(c.x + w - cx), Math.round(c.y + h - cy), 
        c.rot
      ]);
    });

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + rows.map(r => r.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'coordinate_extraction.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [chips, selIds, fieldSize]);

  // Derived
  const scale = SCREEN_SCALE / zoom;
  const fieldPx = { w: fieldSize.w/scale, h: fieldSize.h/scale };
  const selectedChip = selIds.length===1 ? chips.find(c=>c.id===selIds[0]) : null;
  const dispChips = useMemo(() => chips.map(c => {
    const { w, h } = chipDim(c);
    return { ...c, wpx:w/scale, hpx:h/scale, xpx:c.x/scale, ypx:c.y/scale };
  }), [chips, scale]);

  const measDistance = useMemo(() => {
    if (measSel.length !== 2) return null;
    const c1=chips.find(c=>c.id===measSel[0]), c2=chips.find(c=>c.id===measSel[1]);
    if (!c1||!c2) return null;
    const d1=chipDim(c1), d2=chipDim(c2);
    return { dx: Math.max(0,c2.x-(c1.x+d1.w),c1.x-(c2.x+d2.w)), dy: Math.max(0,c2.y-(c1.y+d1.h),c1.y-(c2.y+d2.h)) };
  }, [measSel,chips]);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden', userSelect:'none', touchAction:'none' }}>
      
      {/* Toast Notification */}
      {toast && (
        <div className="toast-container">
          <div className="toast-content">
            <FileSpreadsheet size={16} />
            <span>{toast}</span>
          </div>
        </div>
      )}

      {/* ── Top Menu ── */}
      <header className="top-menu">
        {/* Row 1: Logo & Inputs */}
        <div className="menu-row">
          <div className="menu-title"><Box size={20}/> FloorPlan <span>R1</span></div>
          <div className="menu-divider"/>
          <div className="input-group">
            <span className="input-label">Chip W/H</span>
            <input className="menu-input" value={chipInput.w} placeholder="W" onChange={e=>setChipInput(p=>({...p,w:e.target.value}))}/>
            <input className="menu-input" value={chipInput.h} placeholder="H" onChange={e=>setChipInput(p=>({...p,h:e.target.value}))}/>
          </div>
          <div className="input-group">
            <span className="input-label">Qty</span>
            <input className="menu-input sm" value={chipInput.count} onChange={e=>setChipInput(p=>({...p,count:e.target.value}))}/>
          </div>
          <div className="input-group">
            <span className="input-label">Scribe X/Y</span>
            <input className="menu-input xs" value={scribeInput.x} onChange={e => onScribeChange('x', e.target.value)}/>
            <input className="menu-input xs" value={scribeInput.y} onChange={e => onScribeChange('y', e.target.value)}/>
          </div>
          <div className="input-group">
            <span className="input-label">Field W/H</span>
            <input className="menu-input" value={fieldInput.w} onChange={e=>setFieldInput(p=>({...p,w:e.target.value}))} onBlur={applyFieldSize}/>
            <input className="menu-input" value={fieldInput.h} onChange={e=>setFieldInput(p=>({...p,h:e.target.value}))} onBlur={applyFieldSize}/>
          </div>
        </div>

        {/* Row 2: Actions */}
        <div className="menu-row">
          <button className="btn btn-primary"  onClick={addChips}><Plus size={14}/> Add</button>
          <button className="btn btn-danger"   onClick={deleteSelected}><Trash2 size={14}/> Delete</button>
          <button className="btn btn-ghost"    onClick={resetWorkspace}><RefreshCw size={14}/> Reset</button>
          <div className="menu-divider"/>
          <button className="btn btn-blue"     onClick={rotateSelected}><RotateCw size={14}/> Rotate</button>
          <button className={`btn btn-violet${measuring?' active':''}`} onClick={()=>{setMeasuring(m=>!m);setMeasSel([]);}}><Ruler size={14}/> Ruler</button>
          <button className="btn btn-orange"   onClick={optimizeField}><Maximize2 size={14}/> Optimize</button>
          {backup && <button className="btn btn-ghost" onClick={undoOptimize}><Undo2 size={14}/> Undo</button>}
          <div className="menu-divider"/>
          <button className="btn btn-green"   onClick={exportGDS}><FileDown size={14}/> Export GDS</button>
          <button className="btn btn-green"   onClick={exportCSV}><FileSpreadsheet size={14}/> Coordinates</button>
        </div>

        {/* Row 3: Origin Toggle */}
        <div className="menu-row">
          <button className={`btn btn-ghost origin-toggle ${coordMode==='fc'?'active':''}`} 
                  onClick={()=>setCoordMode(p=>p==='bl'?'fc':'bl')}>
            <Target size={14}/> {coordMode==='bl' ? 'Origin: B-L' : 'Origin: Center'}
          </button>
        </div>
      </header>

      {/* ── Canvas ── */}
      <div
        className="canvas-container"
        ref={containerRef}
        style={{ backgroundSize:`${40*zoom}px ${40*zoom}px` }}
        onPointerDown={onCanvasDown}
      >
        {/* Ruler Mode Banner */}
        {measuring && (
          <div className="ruler-mode-banner">
            <div className="ruler-mode-pulse" />
            <Ruler size={16} /> 
            <span>Ruler Mode Active: <strong>Movement Disabled</strong>. Select two chips to measure.</span>
          </div>
        )}

        <div
          ref={stageRef}
          className="exposure-field"
          style={{ width:fieldPx.w, height:fieldPx.h, left:offset.x, top:offset.y }}
        >
          {dispChips.map(c => {
            const isSel  = selIds.includes(c.id);
            const isMeas = measSel.includes(c.id);
            const isSnap = snapping === c.id;
            let cls = 'chip-object';
            if (isMeas) cls += ' measured';
            else if (c.colliding) cls += ' colliding';
            else if (c.locked) cls += ' locked-chip';
            else if (isSel) cls += ' selected';
            if (isSnap) cls += ' snapping';

            return (
              <div
                key={c.id}
                className={cls}
                style={{
                  width:  c.wpx,
                  height: c.hpx,
                  left:   c.xpx,
                  top:    fieldPx.h - c.ypx - c.hpx,
                  cursor: c.locked ? 'not-allowed' : 'grab',
                  touchAction: 'none'
                }}
                onPointerDown={e => onChipDown(c.id, e)}
              >
                <span className="chip-label-coords" style={{fontSize: clamp(8/zoom, 5, 12)}}>
                  {coordMode === 'bl' 
                    ? `${Math.round(c.x)} / ${Math.round(c.y)}`
                    : `${Math.round(c.x - fieldSize.w/2)} / ${Math.round(c.y - fieldSize.h/2)}`
                  }
                </span>
                <span className="chip-label-name" style={{fontSize: clamp(10/zoom, 8, 18)}}>
                  {c.name}
                </span>

                <button className={`chip-btn chip-btn-lock${c.locked?' locked':''}`}
                  onPointerDown={e=>e.stopPropagation()}
                  onClick={e=>{e.stopPropagation();toggleLock(c.id);}}>
                  {c.locked ? <Lock size={10}/> : <Unlock size={10}/>}
                </button>
                <button className="chip-btn chip-btn-delete"
                  onPointerDown={e=>e.stopPropagation()}
                  onClick={e=>{e.stopPropagation();setChips(p=>recalcCollisions(p.filter(x=>x.id!==c.id), scribe.x, scribe.y));setSelIds(p=>p.filter(x=>x!==c.id));}}>
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        {/* HUDs */}
        <div className="hud-zoom">
          <button className="hud-zoom-btn" onClick={()=>{ setZoom(z=>clamp(z-0.15,0.1,8)); }}><Minus size={13}/></button>
          <span className="hud-zoom-level">Zoom {Math.round(zoom*100)}%</span>
          <button className="hud-zoom-btn" onClick={()=>{ setZoom(z=>clamp(z+0.15,0.1,8)); }}><Plus size={13}/></button>
          <div style={{width:1,height:16,background:'rgba(255,255,255,0.1)',margin:'0 2px'}}/>
          <button className="hud-zoom-btn" onClick={handleReset}><Target size={13}/></button>
        </div>

        {measuring && measDistance && (
          <div className="hud-measure">
            <div className="hud-measure-title">📏 Measurement</div>
            <div className="hud-measure-row">
              <div className="hud-measure-item">
                <span className="hud-measure-item-label">Distance X</span>
                <span className="hud-measure-item-value">{measDistance.dx.toFixed(1)} µm</span>
              </div>
              <div className="hud-measure-item">
                <span className="hud-measure-item-label">Distance Y</span>
                <span className="hud-measure-item-value">{measDistance.dy.toFixed(1)} µm</span>
              </div>
            </div>
          </div>
        )}

        {selectedChip && (
          <div className="hud-panel">
            <div className="hud-panel-title"><Settings size={11}/> Chip Properties</div>
            <input className="hud-name-input" value={editName} onChange={e=>setEditName(e.target.value)} onBlur={()=>handleNameChange(editName)} placeholder="Chip name..."/>
            {[
              {label:'Width', value:selectedChip.w+' µm'},
              {label:'Height',value:selectedChip.h+' µm'},
              {label:'Pos X', value:Math.round(selectedChip.x)+' µm', cls:'blue'},
              {label:'Pos Y', value:Math.round(selectedChip.y)+' µm', cls:'blue'},
              {label:'Rot',   value:selectedChip.rot+'°'},
              {label:'Status',value:selectedChip.colliding?'⚠ Collision':(selectedChip.locked?'🔒 Locked':'✓ OK')},
            ].map(({label,value,cls})=>(
              <div key={label} className="hud-stat">
                <span className="hud-stat-label">{label}</span>
                <span className={`hud-stat-value${cls?' '+cls:''}`}>{value}</span>
              </div>
            ))}
            <div style={{display:'flex',gap:6,marginTop:10}}>
              <button className={`btn btn-icon ${selectedChip.locked?'btn-danger':'btn-ghost'}`}
                style={{flex:1,justifyContent:'center',fontSize:12}} onClick={()=>toggleLock()}>
                {selectedChip.locked ? <><Lock size={13}/> Unlock</> : <><Unlock size={13}/> Lock</>}
              </button>
              <button className="btn btn-ghost btn-icon" onClick={rotateSelected} title="Rotate"><RotateCw size={14}/></button>
              <button className="btn btn-danger btn-icon" onClick={deleteSelected} title="Delete"><Trash2 size={14}/></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
