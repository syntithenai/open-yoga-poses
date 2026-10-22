/**
 * Pose editor tools on yoga-pose/1 data: straighten a limb, put the hips back on the pelvis, straighten the spine,
 * level the hips, and make both sides match. Ports of the book body editor (scripts/yoga_book_body_editor.js, yoga_book_pose_posture.py hips,
 * yoga_book_pose_symmetry.py), working on bone rotations in the pose frame (Z up, facing -Y, X lateral).
 */
import * as THREE from 'three';
import { limbFrom } from './limbs.js';
import { mirrorBoneName } from './mirror.js';
const SIDES = ['L', 'R'];
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const DEG = Math.PI / 180;
const PELVIS_ALLOW_DEG = 5;
const LUMBAR = ['spine05', 'spine04', 'spine03'];
/** The joint between the hips up to the chest. */
const SPINE_CHAIN = ['spine05', 'spine04', 'spine03', 'spine02', 'spine01'];
/** Ankle / wrist heads this close to the lowest bone head count as planted (no contact spec in the app). */
const FOOT_DOWN_M = 0.15;
const HAND_DOWN_M = 0.12;
const IK_DONE_M = 0.001;
const MIDLINE = ['root', 'spine01', 'spine02', 'spine03', 'spine04', 'spine05', 'neck01', 'neck02', 'neck03', 'head'];
/** Left out of the heading fit. */
const DETAIL = ['finger', 'toe', 'metacarpal', 'eye'];
const qFrom = (a) => new THREE.Quaternion(a[1], a[2], a[3], a[0]).normalize();
const round6 = (v) => Math.round(v * 1e6) / 1e6;
const qTo = (q) => {
    const s = q.w < 0 ? -1 : 1;
    return [q.w, q.x, q.y, q.z].map((v) => round6(v * s));
};
const inv = (q) => q.clone().invert();
const mul = (...qs) => qs.reduce((a, b) => a.multiply(b), new THREE.Quaternion());
const angleOf = (q) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));
/** Smallest rotation taking direction a to b. */
function align(a, b) {
    return new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());
}
/** A fraction of q's rotation (same axis). */
function partOf(q, t) {
    const p = q.w < 0 ? q.clone().set(-q.x, -q.y, -q.z, -q.w) : q.clone();
    return new THREE.Quaternion().slerp(p, t);
}
/** Swing-twist split q = swing * twist; the twist about unit `axis` (in q's own frame). */
function twistOf(q, axis) {
    const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
    const t = new THREE.Quaternion(axis.x * d, axis.y * d, axis.z * d, q.w);
    return t.lengthSq() < 1e-12 ? new THREE.Quaternion() : t.normalize();
}
/** World bone rotations (pose frame) plus the root head; positions by forward kinematics. */
class Body {
    W = {};
    W0 = {};
    kids = {};
    sk;
    root;
    constructor(sk, doc) {
        this.sk = sk;
        const bones = doc.bones || {};
        const delta = {};
        for (const n of sk.order) {
            const p = sk.parent[n];
            this.kids[n] = [];
            if (p)
                this.kids[p].push(n);
            // A missing bone follows its parent, as in the viewer's poseState.
            delta[n] = bones[n] ? qFrom(bones[n]) : p ? delta[p].clone() : new THREE.Quaternion();
            this.W[n] = delta[n].clone().multiply(sk.restQ[n]);
            this.W0[n] = this.W[n].clone();
        }
        const head = doc.root?.head;
        this.root = head ? new THREE.Vector3(...head).applyMatrix4(sk.rootParent) : sk.restHead.root.clone();
    }
    has(n) {
        return !!this.W[n];
    }
    positions() {
        const { order, parent, restQ, restHead } = this.sk;
        const P = {};
        for (const n of order) {
            const p = parent[n];
            if (!p) {
                P[n] = this.root.clone();
                continue;
            }
            const d = this.W[p].clone().multiply(inv(restQ[p]));
            P[n] = restHead[n].clone().sub(restHead[p]).applyQuaternion(d).add(P[p]);
        }
        return P;
    }
    /** Rest rotation relative to the parent. */
    restLocal(n) {
        const p = this.sk.parent[n];
        return p ? inv(this.sk.restQ[p]).multiply(this.sk.restQ[n]) : this.sk.restQ[n].clone();
    }
    /** Rotation relative to the parent, in the bone's rest frame (identity at rest). */
    local(n) {
        const p = this.sk.parent[n];
        const parentW = p ? this.W[p] : new THREE.Quaternion();
        return mul(inv(this.restLocal(n)), inv(parentW), this.W[n]);
    }
    /** Sets bone n relative to its parent; descendants follow (carry) or keep their world rotation. */
    setLocal(n, e, carry) {
        const p = this.sk.parent[n];
        const parentW = p ? this.W[p] : new THREE.Quaternion();
        const next = mul(parentW, this.restLocal(n), e).normalize();
        if (carry) {
            const g = next.clone().multiply(inv(this.W[n]));
            for (const k of this.kids[n])
                this.rotate(k, g);
        }
        this.W[n] = next;
    }
    subtree(n) {
        const out = [];
        const stack = [n];
        while (stack.length) {
            const j = stack.pop();
            out.push(j);
            stack.push(...this.kids[j]);
        }
        return out;
    }
    /** Turns bone n and everything below it by world rotation g about n's head. */
    rotate(n, g) {
        for (const j of this.subtree(n))
            this.W[j] = g.clone().multiply(this.W[j]).normalize();
    }
    /** Bone n and its descendants back to their starting world rotation. */
    restore(n) {
        for (const j of this.subtree(n))
            this.W[j] = this.W0[j].clone();
    }
    toDoc(doc) {
        const bones = {};
        for (const n of this.sk.order)
            bones[n] = qTo(this.W[n].clone().multiply(inv(this.sk.restQ[n])));
        const h = this.root.clone().applyMatrix4(this.sk.rootParent.clone().invert());
        const { restAxes: _drop, ...rest } = doc;
        return { ...rest, bones, root: { ...doc.root, head: [round6(h.x), round6(h.y), round6(h.z)] } };
    }
}
/**
 * The selected bone keeps its direction but loses its twist; every joint further out goes straight and
 * untwisted (keeping only its rest twist: the rest elbow and knee are slightly bent), the foot to its rest angle.
 * Hands, fingers and toes keep their shape. Null when the joint isn't on an arm or leg.
 */
export function straightenLimb(doc, sk, joint) {
    const chain = limbFrom(joint);
    if (!chain)
        return null;
    const b = new Body(sk, doc);
    chain.forEach((n, i) => {
        if (!b.has(n))
            return;
        let e;
        if (i === 0) {
            e = b.local(n);
            e.multiply(inv(twistOf(e, Y_AXIS)));
        }
        else if (n.startsWith('foot.')) {
            e = new THREE.Quaternion();
        }
        else {
            const rest = b.restLocal(n);
            e = inv(rest).multiply(twistOf(rest, Y_AXIS));
        }
        b.setLocal(n, e, true);
    });
    return b.toDoc(doc);
}
function twoBoneIk(b, upper, lower, end, target) {
    let P = b.positions();
    const H = P[upper];
    const K = P[lower];
    const A = P[end];
    // Already there: a straight limb would otherwise pick up the reach clamp's small bend.
    if (A.distanceTo(target) < IK_DONE_M)
        return;
    const a = K.distanceTo(H);
    const c = A.distanceTo(K);
    const d = THREE.MathUtils.clamp(target.distanceTo(H), Math.abs(a - c) + 1e-4, a + c - 1e-4);
    const n = new THREE.Vector3().crossVectors(K.clone().sub(H), A.clone().sub(K));
    if (n.length() < 1e-6)
        n.set(1, 0, 0).applyQuaternion(b.W[upper]);
    n.normalize();
    const cos = (x) => Math.acos(THREE.MathUtils.clamp(x, -1, 1));
    const cur = cos(H.clone().sub(K).dot(A.clone().sub(K)) / (a * c));
    const want = cos((a * a + c * c - d * d) / (2 * a * c));
    let best = null;
    for (const sgn of [1, -1]) {
        const g = new THREE.Quaternion().setFromAxisAngle(n, sgn * (want - cur));
        const A2 = A.clone().sub(K).applyQuaternion(g).add(K);
        const err = Math.abs(A2.distanceTo(H) - d);
        if (!best || err < best.err)
            best = { err, g };
    }
    b.rotate(lower, best.g);
    P = b.positions();
    b.rotate(upper, align(P[end].clone().sub(H), target.clone().sub(H)));
    b.restore(end);
}
/**
 * Hip bones (pelvis.L/R) back on the pelvis, within 5° of rest. Fits and hand edits swing them, which shoves the
 * hip joint out of place. Thighs keep their direction; the point between the hip joints stays put (half way when
 * hands are planted too), the lower back bends to bring the shoulders back, and planted feet and hands go back
 * where they were.
 */
export function fixHips(doc, sk) {
    const b = new Body(sk, doc);
    const needed = SIDES.flatMap((s) => [`pelvis.${s}`, `upperleg01.${s}`, `upperarm01.${s}`]);
    if (!needed.every((n) => b.has(n)))
        return doc;
    const hipCentre = () => {
        const P = b.positions();
        return P['upperleg01.L'].clone().add(P['upperleg01.R']).multiplyScalar(0.5);
    };
    const shoulderCentre = () => {
        const P = b.positions();
        return P['upperarm01.L'].clone().add(P['upperarm01.R']).multiplyScalar(0.5);
    };
    const P0 = b.positions();
    const floorZ = Math.min(...Object.values(P0).map((p) => p.z));
    const feet = SIDES.filter((s) => b.has(`foot.${s}`) && P0[`foot.${s}`].z - floorZ < FOOT_DOWN_M);
    const hands = SIDES.filter((s) => b.has(`wrist.${s}`) && P0[`wrist.${s}`].z - floorZ < HAND_DOWN_M);
    const centre = hipCentre();
    for (const s of SIDES) {
        const n = `pelvis.${s}`;
        const e = b.local(n);
        const ang = angleOf(e);
        if (ang > PELVIS_ALLOW_DEG * DEG)
            b.setLocal(n, partOf(e, (PELVIS_ALLOW_DEG * DEG) / ang), false);
    }
    const chest = shoulderCentre();
    b.root.add(centre.sub(hipCentre()).multiplyScalar(hands.length ? 0.5 : 1));
    const lumbar = LUMBAR.filter((n) => b.has(n));
    for (let i = 0; i < 4 && lumbar.length; i++) {
        const pivot = b.positions()[lumbar[0]];
        const g = align(shoulderCentre().sub(pivot), chest.clone().sub(pivot));
        if (angleOf(g) < 0.05 * DEG)
            break;
        const step = partOf(g, 1 / lumbar.length);
        for (const n of lumbar)
            b.rotate(n, step);
    }
    for (const s of feet) {
        if (b.has(`lowerleg01.${s}`))
            twoBoneIk(b, `upperleg01.${s}`, `lowerleg01.${s}`, `foot.${s}`, P0[`foot.${s}`]);
    }
    for (const s of hands) {
        if (b.has(`lowerarm01.${s}`))
            twoBoneIk(b, `upperarm01.${s}`, `lowerarm01.${s}`, `wrist.${s}`, P0[`wrist.${s}`]);
    }
    return b.toDoc(doc);
}
/**
 * The spine from spine05 (the joint between the hips) to the chest in one straight line along its current
 * base-to-chest direction: no bend or twist between vertebrae and no twist against the pelvis. Neck, head and
 * arms ride along; planted hands go back where they were.
 */
export function straightenSpine(doc, sk) {
    const b = new Body(sk, doc);
    const chain = SPINE_CHAIN.filter((n) => b.has(n));
    const last = chain[chain.length - 1];
    const top = last && b.kids[last].find((k) => MIDLINE.includes(k));
    if (!top)
        return doc;
    const P0 = b.positions();
    const floorZ = Math.min(...Object.values(P0).map((p) => p.z));
    const hands = SIDES.filter((s) => b.has(`wrist.${s}`) && P0[`wrist.${s}`].z - floorZ < HAND_DOWN_M);
    const d = P0[top].clone().sub(P0[chain[0]]);
    chain.forEach((n, k) => {
        b.setLocal(n, new THREE.Quaternion(), true);
        const P = b.positions();
        b.rotate(n, align(P[chain[k + 1] ?? top].clone().sub(P[n]), d));
    });
    for (const s of hands) {
        if (b.has(`lowerarm01.${s}`))
            twoBoneIk(b, `upperarm01.${s}`, `lowerarm01.${s}`, `wrist.${s}`, P0[`wrist.${s}`]);
    }
    return b.toDoc(doc);
}
/**
 * Hip bones back on the pelvis (thighs keep their direction), then the whole body turns about the point between
 * the hip joints by the smallest rotation that makes the line across them parallel to the floor.
 */
export function levelHips(doc, sk) {
    const b = new Body(sk, doc);
    if (!SIDES.every((s) => b.has(`pelvis.${s}`) && b.has(`upperleg01.${s}`)))
        return doc;
    for (const s of SIDES)
        b.setLocal(`pelvis.${s}`, new THREE.Quaternion(), false);
    const P = b.positions();
    const hl = P['upperleg01.L'];
    const hr = P['upperleg01.R'];
    const v = hr.clone().sub(hl);
    const flat = new THREE.Vector3(v.x, v.y, 0);
    if (flat.length() < 1e-6)
        return b.toDoc(doc);
    const g = align(v, flat);
    const c = hl.clone().add(hr).multiplyScalar(0.5);
    for (const n of sk.order)
        b.W[n] = g.clone().multiply(b.W[n]).normalize();
    b.root.sub(c).applyQuaternion(g).add(c);
    return b.toDoc(doc);
}
const mirrorQ = (q) => new THREE.Quaternion(q.x, -q.y, -q.z, q.w);
/** Normalised mean of two rotations (signs aligned first). */
function half(a, b) {
    const s = a.dot(b) < 0 ? -1 : 1;
    return new THREE.Quaternion(a.x + s * b.x, a.y + s * b.y, a.z + s * b.z, a.w + s * b.w).normalize();
}
/**
 * Nearest mirror-symmetric rotation: a forward/back bend about X, or that bend plus a half turn about Z
 * (a body lying with its head the other way); q's larger half wins.
 */
function sagittal(q) {
    const a = Math.hypot(q.w, q.x);
    const b = Math.hypot(q.y, q.z);
    return a >= b ? new THREE.Quaternion(q.x / a, 0, 0, q.w / a) : new THREE.Quaternion(0, q.y / b, q.z / b, 0);
}
const turn = (deg) => new THREE.Quaternion().setFromAxisAngle(Z_AXIS, deg * DEG);
function meanResidual(D, yawDeg) {
    const Y = turn(-yawDeg);
    let sum = 0;
    let count = 0;
    for (const n of Object.keys(D)) {
        let r;
        if (n.endsWith('.L')) {
            if (DETAIL.some((d) => n.startsWith(d)) || !D[mirrorBoneName(n)])
                continue;
            const a = Y.clone().multiply(D[n]);
            const b = Y.clone().multiply(D[mirrorBoneName(n)]);
            r = angleOf(inv(a).multiply(mirrorQ(b)));
        }
        else if (MIDLINE.includes(n)) {
            const a = Y.clone().multiply(D[n]);
            r = angleOf(inv(a).multiply(mirrorQ(a)));
        }
        else
            continue;
        sum += r;
        count++;
    }
    return count ? sum / count : 0;
}
/**
 * Turn about Z (degrees) that puts the body's mirror plane on x = 0: coarse 1° search, then 0.1°. yaw and
 * yaw + 180 give the same plane; the one that leaves the root a plain bend about X is returned.
 */
function headingYaw(D) {
    const argmin = (ts) => {
        const scores = ts.map((t) => meanResidual(D, t));
        return ts[scores.indexOf(Math.min(...scores))];
    };
    const range = (from, to, step) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);
    let best = argmin(range(-90, 89, 1));
    best = argmin(range(best - 1, best + 1, 0.1));
    if (D.root) {
        const q = turn(-best).multiply(D.root);
        if (Math.hypot(q.y, q.z) > Math.hypot(q.w, q.x))
            best += 180;
    }
    return ((((best + 180) % 360) + 360) % 360) - 180;
}
/**
 * Both sides made to match about the body's own mirror plane (found first, so a turned body works). With `from`
 * that side is copied onto the other; without, each left/right pair is averaged. Midline bones (spine, neck, head,
 * root) keep only their forward/back bend. The heading and root head are kept.
 */
export function symmetrizePose(doc, sk, from) {
    const b = new Body(sk, doc);
    const D = {};
    for (const n of sk.order)
        D[n] = b.W[n].clone().multiply(inv(sk.restQ[n]));
    const yaw = headingYaw(D);
    const Y = turn(-yaw);
    const Yi = inv(Y);
    const out = { ...D };
    for (const n of Object.keys(D)) {
        const m = mirrorBoneName(n);
        if (n.endsWith('.L') && D[m]) {
            const l = Y.clone().multiply(D[n]);
            const r = mirrorQ(Y.clone().multiply(D[m]));
            const left = from === 'L' ? l : from === 'R' ? r : half(l, r);
            out[n] = Yi.clone().multiply(left);
            out[m] = Yi.clone().multiply(mirrorQ(left));
        }
        else if (!n.endsWith('.L') && !n.endsWith('.R')) {
            out[n] = Yi.clone().multiply(sagittal(Y.clone().multiply(D[n])));
        }
    }
    for (const n of sk.order)
        b.W[n] = out[n].clone().multiply(sk.restQ[n]);
    return b.toDoc(doc);
}
