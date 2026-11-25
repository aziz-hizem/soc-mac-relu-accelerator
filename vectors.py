"""Vecteurs de test partages pour le MAC + ReLU.

Ces valeurs doivent rester identiques a tb_mac_relu.v.
"""

# Entrees signees 8 bits
A = [-3, 2, 5, -2, -128, 127, 0, -128]
B = [4, 3, 4, 3, -128, 127, 5, 1]


def mac_relu_model(a_list, b_list):
    """Modele de reference.

    Retourne, pour chaque cycle, le tuple (produit, ACC, ReLU(ACC)).
    """
    acc = 0
    result = []
    for a, b in zip(a_list, b_list):
        produit = a * b
        acc += produit
        result.append((produit, acc, max(0, acc)))
    return result
