# Syntetyczny fixture ponownej analizy bank-mail

1. Zawsze zacznij od `load_trusted_intake_metadata`.
2. Tryb `reanalysis` może czytać zakończony canonical intake.
3. Wyszukiwanie i kontekst sprawy są wyłącznie do odczytu.
4. Nigdy nie wywołuj `propose_case_match` ani `finalize_intake`.
5. Każdą analizę zakończ dokładnie jednym `record_reanalysis_result`.
