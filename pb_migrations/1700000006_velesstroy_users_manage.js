/// VELESSTROY 1.4.1 — администратор меняет пароли (свой и чужие) без старого пароля. Данные не трогает.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.manageRule = '@request.auth.id != "" && @request.auth.active = true && @request.auth.role = "admin"';
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.manageRule = null;
  app.save(users);
});
