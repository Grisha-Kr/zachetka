/// <reference path="../pb_data/types.d.ts" />

// Файлы можно прикреплять прямо к предмету (конспекты, сделанные домашние задания).
// В attachments добавляется связь subjectId, правила доступа расширяются на неё.

const SUBJ_CREATE = ' && (@request.body.subjectId = "" || @request.body.subjectId.owner = @request.auth.id)';
const SUBJ_UPDATE = ' && (@request.body.subjectId:isset = false || @request.body.subjectId = "" || @request.body.subjectId.owner = @request.auth.id)';

migrate((app) => {
  const att = app.findCollectionByNameOrId("attachments");
  const subjects = app.findCollectionByNameOrId("subjects");
  if (!att.fields.getByName("subjectId")) {
    att.fields.add(new RelationField({ name: "subjectId", collectionId: subjects.id, cascadeDelete: true, maxSelect: 1 }));
  }
  if (!att.createRule.includes("subjectId")) att.createRule += SUBJ_CREATE;
  if (!att.updateRule.includes("subjectId")) att.updateRule += SUBJ_UPDATE;
  app.save(att);
}, (app) => {
  const att = app.findCollectionByNameOrId("attachments");
  att.createRule = att.createRule.replace(SUBJ_CREATE, "");
  att.updateRule = att.updateRule.replace(SUBJ_UPDATE, "");
  att.fields.removeByName("subjectId");
  app.save(att);
});
