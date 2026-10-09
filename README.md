# შეკვეთების რვეული

ქართული შეკვეთების რვეული ონლაინ გამყიდველებისთვის: https://shekvetebi.pages.dev

- საიტი ცარიელი რვეულით იხსნება. პირველი შეკვეთის შენახვისას სერვერზე იქმნება ამ ბრაუზერის რვეული (ექაუნთი ელფოსტის გარეშე), რომელსაც მხოლოდ ამ ბრაუზერის HttpOnly ქუქი ხსნის.
- რეგისტრაცია (ელფოსტა/პაროლი ან Google) იმავე ექაუნთს ამატებს ელფოსტას. არსებულ ექაუნთში შესვლისას ბრაუზერის შეკვეთების გადმოტანა შეიძლება.
- რეგისტრირებულ ექაუნთში ყველა მოწყობილობა ირჩევს სახელს. შეკვეთებზე ინახება ვინ ჩაწერა, შეცვალა და გაგზავნა.
- 12:00-ის Web Push შეხსენება ყველა რვეულს აქვს (Cron, 08:00–08:55 UTC, პატარა ჯგუფებად).

## აგებულება

| ნაწილი | სად | რას აკეთებს |
| --- | --- | --- |
| `server/` | Worker `sales` (D1 `sales-db`, Cron) | API, ექაუნთები, Google OAuth, შეხსენებები |
| `public/` | Pages `shekvetebi` | საიტის ფაილები |
| `pages-site/_worker.js` | Pages | `/api/*` და `/auth/*` გადასცემს Worker-ს service binding-ით |

Worker-ის workers.dev მისამართი 302-ით გადადის `PUBLIC_URL`-ზე. პაროლი ბრაუზერში იჭიმება (PBKDF2, 150 000) და სერვერზე კიდევ ერთხელ (PBKDF2, 20 000, შემთხვევითი მარილით).

Secrets (Worker-ზე): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, სურვილისამებრ `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Google-ის redirect URI: `https://shekvetebi.pages.dev/auth/google/callback`.

## ატვირთვა

Windows: `upload-to-cloudflare.cmd`. სხვაგან: `npm ci && npm run deploy`. სკრიპტი აწყობს secrets-ს, უშვებს D1 მიგრაციებს, ტვირთავს Worker-ს და Pages პროექტს (Pages-ის ფაილები დროებით საქაღალდეში იკრიბება). დეტალები: [START-HERE.txt](START-HERE.txt).

## ლოკალური შემოწმება

```sh
npm ci
node scripts/prepare-dev.mjs
npm run db:local
npm run dev            # http://127.0.0.1:8791
npm test               # ერთეულების ტესტები
npm run test:api       # API ტესტები გაშვებულ სერვერზე
```
