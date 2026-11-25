"""Serveur local de l'interface MAC + ReLU.

Le navigateur envoie une liste de couples (a, b) ; le serveur genere un
testbench, le simule avec Icarus Verilog sur le vrai module mac_relu.v, compare
avec le modele Python de reference et renvoie les resultats en JSON.

Usage :
    python app/server.py              # ouvre http://127.0.0.1:8765
    python app/server.py --port 9000 --no-browser
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP = Path(__file__).resolve().parent
PROJET = APP.parent
STATIC = APP / "static"
CONCEPTION = PROJET / "mac_relu.v"

sys.path.insert(0, str(PROJET))
from vectors import mac_relu_model  # noqa: E402  (modele de reference)

MAX_CYCLES = 200
MAX_BODY = 64 * 1024
TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
}


def trouver_outil(nom):
    """Cherche iverilog / vvp dans le PATH, puis dans les dossiers usuels."""
    chemin = shutil.which(nom)
    if chemin:
        return chemin
    for dossier in (r"C:\iverilog\bin", r"C:\Program Files\iverilog\bin"):
        candidat = Path(dossier) / (nom + ".exe")
        if candidat.exists():
            return str(candidat)
    return None


class ErreurSimulation(Exception):
    pass


def valider(donnees):
    """Verifie la requete et retourne la liste de (a, b, reset)."""
    lignes = donnees.get("rows") if isinstance(donnees, dict) else None
    if not isinstance(lignes, list) or not lignes:
        raise ErreurSimulation("Ajoutez au moins une ligne d'entrees.")
    if len(lignes) > MAX_CYCLES:
        raise ErreurSimulation(f"Maximum {MAX_CYCLES} cycles.")
    resultat = []
    for ligne in lignes:
        try:
            a, b, raz = ligne["a"], ligne["b"], bool(ligne.get("reset", False))
        except (TypeError, KeyError):
            raise ErreurSimulation("Ligne d'entrees invalide.")
        for v in (a, b):
            if isinstance(v, bool) or not isinstance(v, int) or not -128 <= v <= 127:
                raise ErreurSimulation("a et b doivent etre des entiers entre -128 et 127.")
        resultat.append((a, b, raz))
    return resultat


def ecrire_testbench(lignes):
    """Genere un testbench qui affiche une ligne 'CYC ...' par cycle."""
    corps = []
    for a, b, raz in lignes:
        if raz:
            corps.append("    @(negedge clk); reset = 1; #1; reset = 0;")
        else:
            corps.append("    @(negedge clk);")
        corps.append(f"    a = {a}; b = {b};")
        corps.append("    @(posedge clk); #1;")
        corps.append('    $display("CYC %0d %0d %0d %0d %0d", a, b, uut.produit, acc, relu_out);')
    return (
        "`timescale 1ns/1ps\n"
        "module tb_app;\n"
        "reg clk; reg reset = 0;\n"
        "reg signed [7:0] a = 0; reg signed [7:0] b = 0;\n"
        "wire signed [31:0] acc; wire signed [31:0] relu_out;\n"
        "mac_relu uut(.clk(clk), .reset(reset), .a(a), .b(b), .acc(acc), .relu_out(relu_out));\n"
        "initial clk = 0;\n"
        "always #5 clk = ~clk;\n"
        "initial begin\n"
        "    reset = 1; #1; reset = 0;\n"
        + "\n".join(corps)
        + "\n    $finish;\nend\nendmodule\n"
    )


def modele_reference(lignes):
    """Modele Python (vectors.mac_relu_model) avec remise a zero aux lignes marquees."""
    resultat, seg_a, seg_b = [], [], []
    for a, b, raz in lignes:
        if raz and seg_a:
            resultat.extend(mac_relu_model(seg_a, seg_b))
            seg_a, seg_b = [], []
        seg_a.append(a)
        seg_b.append(b)
    if seg_a:
        resultat.extend(mac_relu_model(seg_a, seg_b))
    return resultat


def simuler(lignes):
    iverilog = trouver_outil("iverilog")
    vvp = trouver_outil("vvp")
    if not iverilog or not vvp:
        raise ErreurSimulation(
            "Icarus Verilog est introuvable. Installez-le et ajoutez-le au PATH."
        )

    debut = time.perf_counter()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "tb_app.v").write_text(ecrire_testbench(lignes), encoding="ascii")
        compile_ = subprocess.run(
            [iverilog, "-g2012", "-s", "tb_app", "-o", str(tmp / "sim.vvp"),
             str(CONCEPTION), str(tmp / "tb_app.v")],
            capture_output=True, text=True, timeout=30,
        )
        if compile_.returncode != 0:
            raise ErreurSimulation("Erreur de compilation Verilog : " + compile_.stderr.strip())
        sim = subprocess.run(
            [vvp, str(tmp / "sim.vvp")], capture_output=True, text=True, timeout=30
        )
        if sim.returncode != 0:
            raise ErreurSimulation("Erreur de simulation : " + sim.stderr.strip())
    duree_ms = round((time.perf_counter() - debut) * 1000)

    verilog = []
    for ligne in sim.stdout.splitlines():
        if ligne.startswith("CYC "):
            a, b, produit, acc, relu = (int(x) for x in ligne.split()[1:])
            verilog.append({"a": a, "b": b, "product": produit, "acc": acc, "relu": relu})
    if len(verilog) != len(lignes):
        raise ErreurSimulation("La simulation n'a pas produit tous les cycles.")

    reference = modele_reference(lignes)
    cycles = []
    for (a, b, raz), v, (produit, acc_ref, relu_ref) in zip(lignes, verilog, reference):
        cycles.append({
            **v,
            "reset": raz,
            "python": {"product": produit, "acc": acc_ref, "relu": relu_ref},
            "match": (v["product"], v["acc"], v["relu"]) == (produit, acc_ref, relu_ref),
        })

    return {
        "cycles": cycles,
        "all_match": all(c["match"] for c in cycles),
        "ms": duree_ms,
        "tool": "Icarus Verilog",
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "MacReluApp/1.0"

    def log_message(self, fmt, *args):  # sortie console plus discrete
        pass

    def _json(self, code, objet):
        corps = json.dumps(objet).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corps)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corps)

    def do_GET(self):
        chemin = self.path.split("?", 1)[0]
        if chemin == "/api/health":
            self._json(200, {"iverilog": bool(trouver_outil("iverilog")),
                             "design": CONCEPTION.name})
            return
        if chemin == "/":
            chemin = "/index.html"
        cible = (STATIC / chemin.lstrip("/")).resolve()
        if STATIC not in cible.parents or not cible.is_file():
            self.send_error(404)
            return
        contenu = cible.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(cible.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(contenu)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(contenu)

    def do_POST(self):
        if self.path != "/api/simulate":
            self.send_error(404)
            return
        try:
            taille = int(self.headers.get("Content-Length", "0"))
            if taille <= 0 or taille > MAX_BODY:
                raise ErreurSimulation("Requete invalide.")
            donnees = json.loads(self.rfile.read(taille))
            lignes = valider(donnees)
            self._json(200, simuler(lignes))
        except ErreurSimulation as e:
            self._json(400, {"error": str(e)})
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._json(400, {"error": "Requete invalide."})
        except subprocess.TimeoutExpired:
            self._json(500, {"error": "La simulation a pris trop de temps."})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": f"Erreur interne : {e}"})


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    serveur = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}"
    print(f"Interface MAC + ReLU : {url}   (Ctrl+C pour arreter)")
    if not trouver_outil("iverilog"):
        print("ATTENTION : iverilog est introuvable, la simulation echouera.")
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        print("\nArret.")


if __name__ == "__main__":
    main()
