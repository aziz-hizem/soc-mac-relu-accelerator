import random

import cocotb
from cocotb.triggers import Timer

from vectors import A, B, mac_relu_model


def signed32(valeur):
    """Interprete une valeur non signee 32 bits en signe."""
    if valeur >= 2**31:
        valeur -= 2**32
    return valeur


async def reset_dut(dut):
    """Reset asynchrone, puis remise a zero des entrees."""
    dut.clk.value = 0
    dut.a.value = 0
    dut.b.value = 0
    dut.reset.value = 1
    await Timer(1, unit="ns")
    assert signed32(int(dut.acc.value)) == 0
    assert int(dut.relu_out.value) == 0
    dut.reset.value = 0
    await Timer(1, unit="ns")


async def run_cycle(dut, a, b):
    """Applique (a, b) sur un front montant, puis retourne (ACC, ReLU)."""
    dut.a.value = a
    dut.b.value = b
    await Timer(1, unit="ns")
    dut.clk.value = 1
    await Timer(1, unit="ns")
    acc = signed32(int(dut.acc.value))
    relu = signed32(int(dut.relu_out.value))
    dut.clk.value = 0
    await Timer(1, unit="ns")
    return acc, relu


@cocotb.test()
async def verifier_mac_relu(dut):
    """Vecteurs fixes, dont les cas limites -128 x -128 et 127 x 127."""
    await reset_dut(dut)

    for cycle, (produit, acc_attendu, relu_attendu) in enumerate(
        mac_relu_model(A, B), start=1
    ):
        acc, relu = await run_cycle(dut, A[cycle - 1], B[cycle - 1])

        assert acc == acc_attendu, (
            f"Cycle {cycle}: ACC={acc}, attendu {acc_attendu}"
        )
        assert relu == relu_attendu, (
            f"Cycle {cycle}: ReLU={relu}, attendu {relu_attendu}"
        )
        dut._log.info(f"Cycle {cycle}: ACC={acc}, ReLU={relu} - OK")

    dut._log.info("Tous les tests fixes ont reussi !")


@cocotb.test()
async def verifier_mac_relu_aleatoire(dut):
    """500 cycles aleatoires avec une graine fixe, reset au milieu."""
    rng = random.Random(2026)
    await reset_dut(dut)

    acc_attendu = 0
    for cycle in range(1, 501):
        if cycle == 250:
            # Reset synchrone en cours de calcul
            dut.reset.value = 1
            await Timer(1, unit="ns")
            dut.reset.value = 0
            acc_attendu = 0

        a = rng.randint(-128, 127)
        b = rng.randint(-128, 127)
        acc_attendu += a * b
        relu_attendu = max(0, acc_attendu)

        acc, relu = await run_cycle(dut, a, b)

        assert acc == acc_attendu, (
            f"Cycle {cycle}: ACC={acc}, attendu {acc_attendu}"
        )
        assert relu == relu_attendu, (
            f"Cycle {cycle}: ReLU={relu}, attendu {relu_attendu}"
        )

    dut._log.info("Test aleatoire : 500 cycles ont reussi !")
