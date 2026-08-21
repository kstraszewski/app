<script setup lang="ts">
import type { AuthAccessEmailProps } from '../../shared/auth-email'

defineProps<AuthAccessEmailProps>()
</script>

<template>
  <EHtml lang="pl" dir="ltr">
    <EHead>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="color-scheme" content="light">
      <meta name="supported-color-schemes" content="light">
      <title>{{ subject }}</title>
      <EStyle>
        @media only screen and (max-width: 620px) {
          .oe-shell { padding: 12px 8px 24px !important; }
          .oe-card { padding: 32px 24px !important; }
        }
      </EStyle>
    </EHead>
    <ESubject>{{ subject }}</ESubject>
    <body style="margin:0;padding:0;background:#f5f5f4;color:#1c1917;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;text-size-adjust:100%">
      <div lang="pl" dir="ltr" style="background:#f5f5f4">
        <EPreview id="__vue-email-preview">{{ preheader }}</EPreview>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f5f5f4">
          <tbody>
            <tr>
              <td class="oe-shell" align="center" style="padding:32px 16px 40px">
                <EContainer style="width:100%;max-width:600px">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                    <tbody>
                      <tr>
                        <td style="padding:0 6px 18px;color:#0c0a09;font-size:19px;font-weight:800;letter-spacing:-.3px">OpenExpert</td>
                        <td align="right" style="padding:0 6px 18px;color:#57534e;font-size:12px;line-height:18px">{{ productLabel }}</td>
                      </tr>
                      <tr>
                        <td class="oe-card" colspan="2" style="padding:44px 44px 40px;border:1px solid #e7e5e4;border-radius:16px;background:#ffffff">
                          <EText style="margin:0 0 12px;color:#78716c;font-size:12px;font-weight:700;letter-spacing:1.2px;line-height:18px;text-transform:uppercase">Bezpieczny dostęp</EText>
                          <EHeading style="margin:0 0 18px;color:#0c0a09;font-size:30px;font-weight:700;letter-spacing:-.6px;line-height:37px">{{ title }}</EHeading>
                          <EText style="margin:0 0 28px;color:#57534e;font-size:16px;line-height:26px">{{ intro }}</EText>
                          <table v-if="notice" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px;border-radius:12px;background:#f5f5f4">
                            <tbody><tr><td style="padding:16px 18px;color:#44403c;font-size:14px;line-height:22px"><strong style="color:#1c1917">{{ notice.title }}</strong><br>{{ notice.text }}</td></tr></tbody>
                          </table>
                          <EButton
                            :href="url"
                            :style="{ backgroundColor: '#0c0a09', borderRadius: '9px', boxSizing: 'border-box', color: '#ffffff', display: 'block', fontSize: '16px', fontWeight: '700', lineHeight: '20px', margin: '0 0 22px', padding: '15px 24px', textAlign: 'center', textDecoration: 'none', width: '100%' }"
                          >{{ actionLabel }}</EButton>
                          <EText style="margin:0 0 30px;color:#78716c;font-size:13px;line-height:21px">Jeśli przycisk nie działa, <ELink :href="url" style="color:#292524;font-weight:700;text-decoration:underline">otwórz bezpieczny link w przeglądarce</ELink>.</EText>
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #e7e5e4"><tbody><tr><td style="padding:24px 0 0;color:#78716c;font-size:13px;line-height:21px"><strong style="color:#44403c">Dla Twojego bezpieczeństwa</strong><br>{{ securityText }}</td></tr></tbody></table>
                        </td>
                      </tr>
                      <tr><td colspan="2" align="center" style="padding:20px 16px 0;color:#57534e;font-size:12px;line-height:19px">OpenExpert · wiadomość transakcyjna<br>Identyfikator wiadomości: {{ messageReference }}</td></tr>
                    </tbody>
                  </table>
                </EContainer>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </body>
  </EHtml>
</template>
