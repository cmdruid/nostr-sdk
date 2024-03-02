import {
  Converter,
  ReflectionFlag
} from 'typedoc'

export function load (app) {
  app.converter.on(Converter.EVENT_CREATE_DECLARATION, (
    _context, 
    reflection, 
    _node
  ) => {
    if (reflection.name.startsWith('_')) {
      // Marking them as private to exclude them if excludePrivate is true in typedoc.json
      reflection.setFlag(ReflectionFlag.Private, true);
    }
  })
}
