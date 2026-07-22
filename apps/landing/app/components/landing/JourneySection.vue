<script setup lang="ts">
const journey = [
  {
    icon: 'lucide:house',
    title: 'Nieruchomość',
    description: 'Znalezienie i weryfikacja właściwej nieruchomości',
  },
  {
    icon: 'lucide:landmark',
    title: 'Kredyt',
    description: 'Analiza i wybór najlepszego finansowania',
  },
  {
    icon: 'lucide:shield-check',
    title: 'Ubezpieczenie',
    description: 'Dobór ochrony dla klienta i jego majątku',
  },
  {
    icon: 'lucide:user-round-check',
    title: 'Jeden ekspert',
    description: 'Prowadzi relację i podejmuje kluczowe decyzje',
  },
]
</script>

<template>
  <section id="jak-to-dziala" class="journey-section" aria-labelledby="journey-title">
    <div class="journey-inner">
      <div class="journey-heading">
        <h2 id="journey-title">Ty prowadzisz klienta. Agenci wykonują pracę.</h2>
        <p>Nieruchomość, finansowanie i ubezpieczenie pozostają w jednej sprawie. Agenci korzystają z tego samego kontekstu i wspierają każdy kolejny etap.</p>
      </div>

      <ol class="journey-list">
        <template v-for="(step, index) in journey" :key="step.title">
          <li class="journey-step">
            <span class="journey-step__icon" aria-hidden="true">
              <Icon :name="step.icon" />
            </span>
            <span class="journey-step__copy">
              <strong>{{ step.title }}</strong>
              <small>{{ step.description }}</small>
            </span>
          </li>
          <li v-if="index < journey.length - 1" class="journey-arrow" aria-hidden="true">
            <Icon name="lucide:arrow-right" />
          </li>
        </template>
      </ol>

      <p class="journey-mantra"><span aria-hidden="true" /> Jedna relacja. Jeden system. Ekspert + agenci AI.</p>
    </div>
  </section>
</template>

<style scoped>
.journey-section {
  scroll-margin-top: 88px;
  background: #f7f7f5;
  color: #111;
}

.journey-inner {
  width: min(1340px, calc(100% - 96px));
  margin: 0 auto;
  padding: 49px 0 38px;
}

.journey-heading {
  margin-bottom: 19px;
}

.journey-heading h2 {
  max-width: 760px;
  margin-bottom: 10px;
  font-size: clamp(38px, 3.8vw, 52px);
  font-variation-settings: 'opsz' 52, 'wght' 300;
  font-weight: 300;
  letter-spacing: -0.04em;
  line-height: 1.08;
}

.journey-heading p {
  max-width: 560px;
  color: #4f4f4f;
  font-size: 17px;
  line-height: 1.55;
}

.journey-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px minmax(0, 1fr) 34px minmax(0, 1fr) 34px minmax(0, 1fr);
  align-items: center;
  list-style: none;
}

.journey-step {
  display: grid;
  min-width: 0;
  grid-template-columns: 58px minmax(0, 1fr);
  align-items: center;
  gap: 18px;
}

.journey-step__icon {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border: 1px solid #aaa;
  border-radius: 5px;
  color: #111;
}

.journey-step__icon :deep(svg) {
  width: 27px;
  height: 27px;
  stroke-width: 1.4;
}

.journey-step__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.journey-step__copy strong {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.3;
}

.journey-step__copy small {
  color: #595959;
  font-size: 12.5px;
  line-height: 1.48;
}

.journey-arrow {
  display: grid;
  place-items: center;
  color: #303030;
}

.journey-arrow :deep(svg) {
  width: 24px;
  height: 24px;
  stroke-width: 1.35;
}

.journey-mantra {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 63px;
  color: #3f3f3f;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.journey-mantra span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #111;
}

@media (max-width: 1120px) {
  .journey-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;
    border: 1px solid #d6d6d3;
    background: #d6d6d3;
  }

  .journey-step {
    min-height: 126px;
    background: #f7f7f5;
    padding: 24px;
  }

  .journey-arrow {
    display: none;
  }
}

@media (max-width: 767px) {
  .journey-inner {
    width: min(100% - 40px, 620px);
    padding: 58px 0 54px;
  }

  .journey-heading {
    margin-bottom: 34px;
  }

  .journey-heading h2 {
    margin-bottom: 14px;
    font-size: clamp(34px, 10vw, 44px);
  }

  .journey-heading p {
    font-size: 15.5px;
    line-height: 1.6;
  }

  .journey-list {
    display: flex;
    border: 0;
    background: transparent;
    flex-direction: column;
    gap: 0;
  }

  .journey-step {
    width: 100%;
    min-height: 0;
    grid-template-columns: 52px minmax(0, 1fr);
    gap: 16px;
    border-top: 1px solid #d5d5d2;
    padding: 22px 0;
  }

  .journey-step:last-of-type {
    border-bottom: 1px solid #d5d5d2;
  }

  .journey-step__icon {
    width: 52px;
    height: 52px;
  }

  .journey-step__copy strong {
    font-size: 16px;
  }

  .journey-step__copy small {
    font-size: 13px;
  }

  .journey-mantra {
    align-items: flex-start;
    margin-top: 30px;
    font-size: 10px;
    line-height: 1.6;
  }

  .journey-mantra span {
    flex: 0 0 auto;
    margin-top: 4px;
  }
}

@media (max-width: 359px) {
  .journey-inner {
    width: calc(100% - 32px);
  }
}
</style>
