"""Modele de reference Python (NumPy) du MAC + ReLU."""

import numpy as np

from vectors import A, B, mac_relu_model

a = np.array(A, dtype=np.int8)
b = np.array(B, dtype=np.int8)

print("Cycle | Produit |  ACC  | ReLU")
print("-------------------------------")

for i, (produit, acc, relu) in enumerate(mac_relu_model(a.tolist(), b.tolist()), start=1):
    print(f"{i:^5} | {produit:^7} | {acc:^5} | {relu:^4}")
