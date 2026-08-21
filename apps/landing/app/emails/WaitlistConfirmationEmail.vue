<script setup lang="ts">
defineProps<{ subject: string, preheader: string, siteUrl?: string }>()
</script>

<template>
  <EHtml lang="pl" dir="ltr">
    <EHead><meta name="viewport" content="width=device-width, initial-scale=1"><title>{{ subject }}</title></EHead>
    <ESubject>{{ subject }}</ESubject>
    <body style="margin:0;padding:0;background:#f5f5f4;color:#1c1917;font-family:Arial,Helvetica,sans-serif"><div lang="pl" dir="ltr" style="background:#f5f5f4">
      <EPreview id="__vue-email-preview">{{ preheader }}</EPreview>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%"><tbody><tr><td align="center" style="padding:32px 16px 40px"><EContainer style="width:100%;max-width:560px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #e7e5e4;border-radius:16px;background:#ffffff"><tbody><tr><td style="padding:40px 36px">
          <EText style="margin:0 0 12px;color:#78716c;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase">OpenExpert</EText>
          <EHeading style="margin:0 0 16px;color:#0c0a09;font-size:28px;line-height:36px">Twój kontakt jest zapisany</EHeading>
          <EText style="margin:0;color:#57534e;font-size:16px;line-height:26px">Damy Ci znać o dostępie i kolejnych krokach dla osób oraz firm, które chcą uruchomić lub rozwinąć własne pośrednictwo.</EText>
          <EButton v-if="siteUrl" :href="siteUrl" :style="{ backgroundColor:'#0c0a09', borderRadius:'9px', color:'#ffffff', display:'inline-block', fontSize:'16px', fontWeight:'700', margin:'28px 0 0', padding:'14px 20px', textDecoration:'none' }">Poznaj OpenExpert</EButton>
          <EText style="margin:32px 0 0;color:#78716c;font-size:12px;line-height:19px">Otrzymujesz tę wiadomość, ponieważ zapisano ten adres do programu wczesnego dostępu OpenExpert.</EText>
        </td></tr></tbody></table>
      </EContainer></td></tr></tbody></table>
    </div></body>
  </EHtml>
</template>
