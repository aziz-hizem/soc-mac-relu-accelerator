"use strict";

// ---------- Etat ----------
const EXEMPLE = [[-3, 4], [2, 3], [5, 4], [-2, 3], [-128, -128], [127, 127], [0, 5], [-128, 1]];
const MAX_LIGNES = 64;

const etat = {
  lignes: [],      // [{a, b, reset}]
  cycles: [],      // resultats de la simulation
  courant: 0,
  lecture: null,   // identifiant de setInterval
  requete: null,   // AbortController
  minuteur: null,  // debounce
};

const $ = (sel, racine = document) => racine.querySelector(sel);
const SVG_NS = "http://www.w3.org/2000/svg";

// Affichage des nombres : signe moins typographique, espaces entre milliers
const fmt = (n) => n.toLocaleString("fr-FR").replace(/[-−]/, "−");
const signe = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "zero");

// ---------- Saisie ----------
function entierValide(v) {
  return Number.isInteger(v) && v >= -128 && v <= 127;
}

function dessinerLignes() {
  const conteneur = $("#rows");
  conteneur.innerHTML = "";
  etat.lignes.forEach((l, i) => {
    const div = document.createElement("div");
    div.className = "row";
    div.dataset.i = i;
    div.innerHTML = `
      <span class="idx">${i + 1}</span>
      <input type="number" min="-128" max="127" step="1" value="${l.a}" data-champ="a" aria-label="a, cycle ${i + 1}">
      <input type="number" min="-128" max="127" step="1" value="${l.b}" data-champ="b" aria-label="b, cycle ${i + 1}">
      <input type="checkbox" ${l.reset ? "checked" : ""} data-champ="reset" aria-label="Remise à zéro avant le cycle ${i + 1}">
      <button class="del" type="button" aria-label="Supprimer le cycle ${i + 1}">×</button>`;
    conteneur.appendChild(div);
  });
  marquerLigneActive();
}

function marquerLigneActive() {
  document.querySelectorAll("#rows .row").forEach((r, i) =>
    r.classList.toggle("active", i === etat.courant));
}

$("#rows").addEventListener("input", (e) => {
  const champ = e.target.dataset.champ;
  const i = Number(e.target.closest(".row").dataset.i);
  if (champ === "reset") {
    etat.lignes[i].reset = e.target.checked;
  } else {
    const v = e.target.value === "" ? NaN : Number(e.target.value);
    etat.lignes[i][champ] = v;
    e.target.classList.toggle("invalid", !entierValide(v));
  }
  planifier();
});

$("#rows").addEventListener("click", (e) => {
  const ligne = e.target.closest(".row");
  if (!ligne) return;
  const i = Number(ligne.dataset.i);
  if (e.target.classList.contains("del")) {
    etat.lignes.splice(i, 1);
    dessinerLignes();
    planifier();
  } else if (e.target.tagName !== "INPUT") {
    aller(i);
  }
});

$("#btn-add").addEventListener("click", () => {
  if (etat.lignes.length >= MAX_LIGNES) return;
  etat.lignes.push({ a: 1, b: 1, reset: false });
  dessinerLignes();
  planifier();
  const rows = $("#rows");
  rows.scrollTop = rows.scrollHeight;
});

$("#btn-example").addEventListener("click", () => {
  etat.lignes = EXEMPLE.map(([a, b]) => ({ a, b, reset: false }));
  etat.courant = 0;
  dessinerLignes();
  planifier(0);
});

$("#btn-random").addEventListener("click", () => {
  const alea = () => Math.floor(Math.random() * 256) - 128;
  etat.lignes = Array.from({ length: 8 }, () => ({ a: alea(), b: alea(), reset: false }));
  etat.courant = 0;
  dessinerLignes();
  planifier(0);
});

$("#btn-clear").addEventListener("click", () => {
  arreter();
  etat.lignes = [];
  etat.cycles = [];
  etat.courant = 0;
  dessinerLignes();
  tout();
  statut("idle", "Prêt");
});

// ---------- Simulation ----------
function statut(classe, texte) {
  const el = $("#status");
  el.className = "pill " + classe;
  el.textContent = texte;
}

function planifier(delai = 280) {
  clearTimeout(etat.minuteur);
  statut("busy", "Simulation…");
  etat.minuteur = setTimeout(simuler, delai);
}

async function simuler() {
  if (etat.requete) etat.requete.abort();

  if (etat.lignes.length === 0) {
    etat.cycles = [];
    tout();
    statut("idle", "Prêt");
    return;
  }
  const invalide = etat.lignes.some((l) => !entierValide(l.a) || !entierValide(l.b));
  if (invalide) {
    statut("bad", "Valeurs invalides : entiers de −128 à 127");
    return;
  }

  const ctrl = new AbortController();
  etat.requete = ctrl;
  try {
    const rep = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: etat.lignes }),
      signal: ctrl.signal,
    });
    const donnees = await rep.json();
    if (!rep.ok) throw new Error(donnees.error || "Erreur du serveur");

    etat.cycles = donnees.cycles;
    etat.courant = Math.min(etat.courant, etat.cycles.length - 1);
    if (etat.initial !== null) {   // ?cycle=N dans l'URL : ouvre directement ce cycle
      etat.courant = Math.max(0, Math.min(etat.initial - 1, etat.cycles.length - 1));
      etat.initial = null;
    }
    tout();
    if (donnees.all_match) {
      statut("ok", `Verilog = Python ✓ · ${donnees.cycles.length} cycles · ${donnees.ms} ms`);
    } else {
      statut("bad", "Différence entre Verilog et Python");
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    etat.cycles = [];
    tout();
    statut("bad", err.message);
  }
}

// ---------- Lecteur ----------
function aller(i) {
  if (!etat.cycles.length) return;
  etat.courant = Math.max(0, Math.min(i, etat.cycles.length - 1));
  rendreCourant(true);
}

function arreter() {
  clearInterval(etat.lecture);
  etat.lecture = null;
  $("#btn-play").textContent = "▶";
  $("#btn-play").setAttribute("aria-label", "Lecture");
}

function basculerLecture() {
  if (etat.lecture) { arreter(); return; }
  if (!etat.cycles.length) return;
  if (etat.courant >= etat.cycles.length - 1) aller(0);
  $("#btn-play").textContent = "❚❚";
  $("#btn-play").setAttribute("aria-label", "Pause");
  etat.lecture = setInterval(() => {
    if (etat.courant >= etat.cycles.length - 1) { arreter(); return; }
    aller(etat.courant + 1);
  }, 1000);
}

$("#btn-prev").addEventListener("click", () => { arreter(); aller(etat.courant - 1); });
$("#btn-next").addEventListener("click", () => { arreter(); aller(etat.courant + 1); });
$("#btn-play").addEventListener("click", basculerLecture);
$("#slider").addEventListener("input", (e) => { arreter(); aller(Number(e.target.value)); });

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" && e.target.type !== "range") return;
  if (e.key === "ArrowRight") { arreter(); aller(etat.courant + 1); }
  else if (e.key === "ArrowLeft") { arreter(); aller(etat.courant - 1); }
  else if (e.key === " " && e.target.tagName !== "BUTTON") { e.preventDefault(); basculerLecture(); }
});

// ---------- Rendu ----------
function tout() {
  const n = etat.cycles.length;
  const slider = $("#slider");
  slider.max = Math.max(0, n - 1);
  slider.disabled = n === 0;
  dessinerChronogramme();
  dessinerTableau();
  rendreCourant(false);
}

function rendreCourant(anime) {
  const n = etat.cycles.length;
  $("#slider").value = etat.courant;
  $("#cycle-label").textContent = n ? `Cycle ${etat.courant + 1} / ${n}` : "Cycle –";
  marquerLigneActive();

  document.querySelectorAll("#table tbody tr").forEach((tr, i) =>
    tr.classList.toggle("active", i === etat.courant));

  const curseur = $("#wave .cursor");
  const ligne = $("#wave .cursor-line");
  if (curseur) {
    const x = Number(curseur.dataset.x0) + etat.courant * Number(curseur.dataset.col);
    curseur.setAttribute("x", x);
    ligne.setAttribute("x1", x + Number(curseur.dataset.col) / 2);
    ligne.setAttribute("x2", x + Number(curseur.dataset.col) / 2);
    const conteneur = $("#wave .wave-scroll");
    const gauche = x - 40, droite = x + Number(curseur.dataset.col) + 40;
    if (gauche < conteneur.scrollLeft) conteneur.scrollTo({ left: gauche, behavior: "smooth" });
    else if (droite > conteneur.scrollLeft + conteneur.clientWidth)
      conteneur.scrollTo({ left: droite - conteneur.clientWidth, behavior: "smooth" });
  }

  const ids = ["v-a", "v-b", "v-prod", "v-old", "v-acc", "v-relu"];
  if (!n) {
    ids.forEach((id) => { const t = $("#" + id); t.textContent = "–"; t.removeAttribute("class"); t.classList.add("num"); });
    $("#explain").textContent = "Ajoutez des entrées pour lancer la simulation.";
    $("#out-box").classList.remove("relu-on", "relu-off");
    return;
  }

  const c = etat.cycles[etat.courant];
  const avant = c.reset ? 0 : c.acc - c.product;
  const valeurs = { "v-a": c.a, "v-b": c.b, "v-prod": c.product, "v-old": avant, "v-acc": c.acc, "v-relu": c.relu };
  const taille = { "v-prod": "small", "v-old": "small", "v-acc": "big" };
  for (const [id, v] of Object.entries(valeurs)) {
    const t = $("#" + id);
    const change = t.textContent !== fmt(v);
    t.textContent = fmt(v);
    t.setAttribute("class", "num " + (taille[id] || "") + " " + (id === "v-acc" || id === "v-relu" ? signe(v) : ""));
    if (anime && change) { void t.getBoundingClientRect(); t.classList.add("pop"); }
  }
  const reg = $("#reg-box");
  reg.classList.remove("flash");
  if (anime) { void reg.getBoundingClientRect(); reg.classList.add("flash"); }
  const sortie = $("#out-box");
  sortie.classList.toggle("relu-on", c.acc > 0);
  sortie.classList.toggle("relu-off", c.acc <= 0);

  $("#explain").innerHTML = explication(c, avant);
}

function explication(c, avant) {
  let t = `<strong>Cycle ${etat.courant + 1}.</strong> `;
  if (c.reset) t += "Un reset remet d'abord ACC à 0. ";
  t += `Le circuit calcule ${fmt(c.a)} × ${fmt(c.b)} = <strong>${fmt(c.product)}</strong>, `
     + `puis l'ajoute à l'ancien ACC : ${fmt(avant)} + (${fmt(c.product)}) = <strong>${fmt(c.acc)}</strong>. `;
  if (c.acc > 0) t += `La somme est positive, la ReLU la laisse passer : <strong>${fmt(c.relu)}</strong>.`;
  else if (c.acc === 0) t += "La somme est nulle, la ReLU renvoie <strong>0</strong>.";
  else t += "La somme est négative, la ReLU la remplace par <strong>0</strong>.";
  return t;
}

// ---------- Tableau ----------
function dessinerTableau() {
  const corps = $("#table tbody");
  corps.innerHTML = "";
  if (!etat.cycles.length) {
    corps.innerHTML = '<tr><td class="empty" colspan="7">Aucun résultat pour le moment.</td></tr>';
    return;
  }
  etat.cycles.forEach((c, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}${c.reset ? " ↺" : ""}</td>
      <td>${fmt(c.a)}</td><td>${fmt(c.b)}</td>
      <td class="${signe(c.product)}">${fmt(c.product)}</td>
      <td class="${signe(c.acc)}">${fmt(c.acc)}</td>
      <td class="${signe(c.relu)}">${fmt(c.relu)}</td>
      <td class="${c.match ? "okcell" : "badcell"}">${c.match ? "✓ identique" : "✗ différent"}</td>`;
    tr.addEventListener("click", () => { arreter(); aller(i); });
    corps.appendChild(tr);
  });
  const actif = corps.children[etat.courant];
  if (actif) actif.classList.add("active");
}

// ---------- Chronogramme ----------
function el(nom, attrs = {}, texte) {
  const e = document.createElementNS(SVG_NS, nom);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (texte !== undefined) e.textContent = texte;
  return e;
}

// Fusionne les segments consecutifs de meme valeur
function fusionner(segments) {
  const sortie = [];
  for (const s of segments) {
    const dernier = sortie[sortie.length - 1];
    if (dernier && dernier.v === s.v && dernier.t1 === s.t0) dernier.t1 = s.t1;
    else sortie.push({ ...s });
  }
  return sortie;
}

function dessinerChronogramme() {
  const conteneur = $("#wave");
  conteneur.innerHTML = "";
  const n = etat.cycles.length;
  if (!n) {
    conteneur.innerHTML = '<p class="hint small">Le chronogramme apparaît après la simulation.</p>';
    return;
  }

  const col = 76, x0 = 4, hauteurLigne = 40, haut = 24;
  const lignes = ["clk", "reset", "a", "b", "produit", "acc", "relu_out"];

  // Colonne des noms de signaux (fixe) + zone defilante pour le dessin
  const enveloppe = document.createElement("div");
  enveloppe.className = "wave-wrap";
  const noms = document.createElement("div");
  noms.className = "wave-labels";
  noms.style.paddingTop = haut + "px";
  lignes.forEach((nom) => {
    const d = document.createElement("div");
    d.style.height = hauteurLigne + "px";
    d.textContent = nom;
    noms.appendChild(d);
  });
  const defilant = document.createElement("div");
  defilant.className = "wave-scroll";
  enveloppe.append(noms, defilant);
  const largeur = x0 + n * col + 8;
  const hauteur = haut + lignes.length * hauteurLigne + 8;
  const svg = el("svg", { viewBox: `0 0 ${largeur} ${hauteur}`, width: largeur, height: hauteur,
                          role: "img", "aria-label": "Chronogramme de la simulation" });

  // Segments par signal : un cycle = [i, i+1], front montant au milieu
  const seg = { a: [], b: [], produit: [], acc: [], relu_out: [] };
  etat.cycles.forEach((c, i) => {
    const prec = i === 0 ? 0 : etat.cycles[i - 1].acc;
    const avant = c.reset ? 0 : prec;
    seg.a.push({ t0: i, t1: i + 1, v: c.a });
    seg.b.push({ t0: i, t1: i + 1, v: c.b });
    seg.produit.push({ t0: i, t1: i + 1, v: c.product });
    seg.acc.push({ t0: i, t1: i + 0.5, v: avant }, { t0: i + 0.5, t1: i + 1, v: c.acc });
    seg.relu_out.push({ t0: i, t1: i + 0.5, v: Math.max(0, avant) }, { t0: i + 0.5, t1: i + 1, v: c.relu });
  });

  const X = (t) => x0 + t * col;
  const Y = (k) => haut + k * hauteurLigne;

  // Grille et graduations de cycle
  for (let i = 0; i <= n; i++) svg.appendChild(el("line", { class: "grid", x1: X(i), x2: X(i), y1: haut - 4, y2: hauteur - 6 }));
  for (let i = 0; i < n; i++) svg.appendChild(el("text", { class: "tick", x: X(i + 0.5), y: 14 }, `cycle ${i + 1}`));

  // Curseur du cycle courant (inséré avant les signaux pour rester en dessous)
  const curseur = el("rect", { class: "cursor", x: X(etat.courant), y: haut - 4, width: col,
                               height: lignes.length * hauteurLigne, "data-x0": x0, "data-col": col });
  svg.appendChild(curseur);

  // clk et reset
  const yh = (k) => Y(k) + 9, yb = (k) => Y(k) + hauteurLigne - 9;
  let d = `M ${X(0)} ${yb(0)}`;
  for (let i = 0; i < n; i++) d += ` H ${X(i + 0.5)} V ${yh(0)} H ${X(i + 1)} V ${yb(0)}`;
  svg.appendChild(el("path", { class: "digital", d }));

  let r = `M ${X(0)} ${yb(1)}`;
  etat.cycles.forEach((c, i) => {
    if (c.reset) r += ` H ${X(i)} V ${yh(1)} H ${X(i + 0.14)} V ${yb(1)}`;
  });
  r += ` H ${X(n)}`;
  svg.appendChild(el("path", { class: "digital reset", d: r }));

  // Bus
  const bus = (k, segments, coloriser) => {
    for (const s of fusionner(segments)) {
      const xa = X(s.t0) + 1, xb = X(s.t1) - 1, ya = Y(k) + 7, yb2 = Y(k) + hauteurLigne - 7, ym = (ya + yb2) / 2, ch = 5;
      const classe = "bus " + (coloriser ? signe(s.v) : "plain");
      svg.appendChild(el("polygon", { class: classe,
        points: `${xa + ch},${ya} ${xb - ch},${ya} ${xb},${ym} ${xb - ch},${yb2} ${xa + ch},${yb2} ${xa},${ym}` }));
      if (xb - xa > 34) svg.appendChild(el("text", { class: "busval", x: (xa + xb) / 2, y: ym + 4 }, fmt(s.v)));
    }
  };
  bus(2, seg.a, false);
  bus(3, seg.b, false);
  bus(4, seg.produit, true);
  bus(5, seg.acc, true);
  bus(6, seg.relu_out, true);

  // Ligne verticale du cycle courant
  svg.appendChild(el("line", { class: "cursor-line", x1: X(etat.courant + 0.5), x2: X(etat.courant + 0.5),
                               y1: haut - 4, y2: haut + lignes.length * hauteurLigne - 4 }));

  svg.addEventListener("click", (e) => {
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (largeur / rect.width);
    const i = Math.floor((x - x0) / col);
    if (i >= 0 && i < n) { arreter(); aller(i); }
  });

  defilant.appendChild(svg);
  conteneur.appendChild(enveloppe);
}

// ---------- Demarrage ----------
const cycleUrl = parseInt(new URLSearchParams(location.search).get("cycle"), 10);
etat.initial = Number.isInteger(cycleUrl) ? cycleUrl : null;
etat.lignes = EXEMPLE.map(([a, b]) => ({ a, b, reset: false }));
dessinerLignes();
tout();
planifier(0);
