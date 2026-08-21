<script setup lang="ts">
import { computed } from 'vue'
import type { TransactionalEmailProps } from '../../shared/transactional-email'

const props = defineProps<TransactionalEmailProps>()

const statusStyle = computed(() => ({
  neutral: 'background:#f5f5f4;color:#44403c',
  info: 'background:#eff6ff;color:#1e40af',
  success: 'background:#ecfdf5;color:#065f46',
  danger: 'background:#fef2f2;color:#991b1b',
}[props.status?.tone ?? 'neutral']))

const noticeStyle = computed(() => ({
  neutral: 'background:#f5f5f4;color:#44403c',
  info: 'background:#eff6ff;color:#1e3a8a',
  success: 'background:#ecfdf5;color:#065f46',
  danger: 'background:#fef2f2;color:#991b1b',
}[props.notice?.tone ?? 'neutral']))
</script>

<template>
  <EHtml lang="pl" dir="ltr">
    <EHead>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="color-scheme" content="light">
      <meta name="supported-color-schemes" content="light">
      <title>{{ subject }}</title>
      <EStyle>@media only screen and (max-width: 620px) { .oe-shell { padding:12px 8px 24px !important; } .oe-card { padding:32px 24px !important; } }</EStyle>
    </EHead>
    <ESubject>{{ subject }}</ESubject>
    <body style="margin:0;padding:0;background:#f5f5f4;color:#1c1917;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;text-size-adjust:100%">
      <div lang="pl" dir="ltr" style="background:#f5f5f4">
        <EPreview id="__vue-email-preview">{{ preheader }}</EPreview>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f5f5f4"><tbody><tr><td class="oe-shell" align="center" style="padding:32px 16px 40px">
          <EContainer style="width:100%;max-width:600px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tbody>
            <tr><td style="padding:0 6px 18px;color:#0c0a09;font-size:19px;font-weight:800;letter-spacing:-.3px">{{ brand }}</td><td align="right" style="padding:0 6px 18px;color:#57534e;font-size:12px;line-height:18px">{{ brandNote || 'Wiadomość transakcyjna' }}</td></tr>
            <tr><td class="oe-card" colspan="2" style="padding:44px 44px 40px;border:1px solid #e7e5e4;border-radius:16px;background:#ffffff">
              <EText style="margin:0 0 12px;color:#78716c;font-size:12px;font-weight:700;letter-spacing:1.2px;line-height:18px;text-transform:uppercase">{{ eyebrow }}</EText>
              <EText v-if="status" :style="`display:inline-block;margin:0 0 14px;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.4px;${statusStyle}`">{{ status.label }}</EText>
              <EHeading style="margin:0 0 18px;color:#0c0a09;font-size:30px;font-weight:700;letter-spacing:-.6px;line-height:37px">{{ title }}</EHeading>
              <EText v-if="greeting" style="margin:0 0 12px;color:#44403c;font-size:16px;line-height:26px">{{ greeting }}</EText>
              <EText style="margin:0 0 28px;color:#57534e;font-size:16px;line-height:26px">{{ intro }}</EText>
              <table v-if="details?.length" role="presentation" class="oe-details" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px;border:1px solid #e7e5e4;border-radius:12px;background:#fafaf9"><tbody>
                <tr v-for="(detail, index) in details" :key="`${detail.label}-${index}`"><td :style="`padding:${index === 0 ? '17px' : '0 17px 17px'};color:#78716c;font-size:13px;line-height:20px;vertical-align:top;width:40%`">{{ detail.label }}</td><td :style="`padding:${index === 0 ? '17px' : '0 17px 17px'};color:#1c1917;font-size:14px;font-weight:700;line-height:20px;text-align:right;vertical-align:top`">{{ detail.value }}</td></tr>
              </tbody></table>
              <table v-if="notice" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" :style="`margin:0 0 28px;border-radius:12px;${noticeStyle}`"><tbody><tr><td style="padding:16px 18px;font-size:14px;line-height:22px"><strong>{{ notice.title }}</strong><br>{{ notice.text }}</td></tr></tbody></table>
              <div v-if="listItems?.length" style="margin:0 0 28px"><EText v-if="listTitle" style="margin:0 0 10px;color:#292524;font-size:16px;font-weight:700;line-height:24px">{{ listTitle }}</EText><ul style="margin:0;padding-left:22px;color:#57534e;font-size:14px;line-height:23px"><li v-for="(item, index) in listItems" :key="index">{{ item }}</li></ul></div>
              <table v-if="securityText" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #e7e5e4"><tbody><tr><td style="padding:24px 0 0;color:#78716c;font-size:13px;line-height:21px"><strong style="color:#44403c">Dla Twojego bezpieczeństwa</strong><br>{{ securityText }}</td></tr></tbody></table>
            </td></tr>
            <tr><td colspan="2" align="center" style="padding:20px 16px 0;color:#57534e;font-size:12px;line-height:19px">{{ footer }}</td></tr>
          </tbody></table></EContainer>
        </td></tr></tbody></table>
      </div>
    </body>
  </EHtml>
</template>
