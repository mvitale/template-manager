/*
 * Wrapper for a Card instance or JSONified Card data for getting and setting
 * field values.
 */

var exports = (function() {
  var exports = {};

  var templateSupplier = null
    ;

  exports.setTemplateSupplier = function(supplier) {
    templateSupplier = supplier;
  };

  exports.newInstance = function(card, cb) {
    if (!templateSupplier) {
      return cb(new Error('Template supplier not set'));
    }

    templateSupplier.supply(card.templateName, function(err, template) {
      if (err) {
        return cb(err);
      }

      return cb(null, new CardWrapper(card, template));
    });
  };

  function CardWrapper(card, template) {
    var card = card
      , template = template
      , that = this
      , changeCbs = []
      ;

    var defaultZoomLevel = 0
      ;

    /*
     * Register a callback to be called when data is changed. No arguments
     * are passed to the callback.
     */
    function change(cb) {
      changeCbs.push(cb);
    }
    that.change = change;

    /*
     * Call all callbacks registered with this.change.
     */
    function changeEvent() {
      changeCbs.forEach(function(cb) {
        cb();
      });
    }

    /*
     * Get the width of this card, as specified in its template
     */
    function width() {
      return template.width;
    }
    that.width = width;

    /*
     * Get the height of this card, as specified in its template.
     */
    function height() {
      return template.height;
    }
    that.height = height;

    /*
     * True if this card's template contains a field with name <name> and
     * type <type>, false o/w.
     */
    function checkFieldNameValid(name, type) {
      // TODO: check this condition
      if (!(name in template.fields) || template.fields[name].type !== type) {
        throw new Error('invalid field name');
      }
    }

    /*
     * Set an attribute for a field, e.g., zoomLevel for an image field.
     */
    function setDataAttr(fieldName, attr, value) {
      var data = card.data[fieldName];

      if (!data) {
        data = {};
        card.data[fieldName] = data;
      }

      if (!data.value) {
        data.value = {};
      }

      data.value[attr] = value;


      changeEvent();
    }
    that.setDataAttr = setDataAttr;

    /*
     * Get the value of a data attribute for a field, or <defaultVal>
     * if it isn't set or is set to null.
     */
    function getDataAttr(fieldName, attr, defaultVal) {
      var data = card.data[fieldName]
        , value = data ? data.value : null
        , attrVal = value ? value[attr] : null
        ;

      if (!attrVal) {
        attrVal = defaultVal;
      }

      return attrVal;
    }
    that.getDataAttr = getDataAttr;

    /*
     * Get the list of default choices for a field.
     */
    that.getFieldChoices = function(fieldId) {
      return card.choices[fieldId];
    }

    /*
     * Get the drawing coordinates and dimensions for an 'image' field.
     */
    that.getImageLocation = function(fieldName) {
      var field = template.fields[fieldName];

      checkFieldNameValid(fieldName, 'image');

      return {
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height
      };
    }

    /*
     * Get the field specification with a given id from the template enriched
     * with the id as an added attribute.
     */
    function fieldForId(id) {
      var field = template.fields[id];
      return Object.assign({ id: id } , field);
    }

    /*
     * Get all editable fields from the Card's template
     */
    function editableFields() {
      return fields().filter(function(field) {
        return field.label != null;
      });
    }

    /*
     * Get all fields from the Card's template
     */
    function fields() {
      var ret = []
        , fieldIds = Object.keys(template.fields)
        , fieldId = null
        , field = null;

      for (var i = 0; i < fieldIds.length; i++) {
        fieldId = fieldIds[i];

        ret.push(fieldForId(fieldId));
      }

      return ret;
    }

    /*
     * Get all editable image fields from the Card's template
     */
    function imageFields() {
      return editableFields().filter(function(field) {
        return field.type === 'image';
      });
    }
    that.imageFields = imageFields;

    /*
     * Given a choiceIndex and a list of fieldChoices, return the corresponding
     * value(s). choiceIndex may be a number or an Array. In the latter case,
     * a list of values is returned.
     */
    function resolveChoice(choiceIndex, fieldChoices) {
      var chosenValue = null;

      if (typeof choiceIndex === 'number') {
        chosenValue = fieldChoices[choiceIndex];
      } else if (Array.isArray(choiceIndex)) { // Assume array of indices
        chosenValue = [];

        choiceIndex.forEach(function(index) {
         chosenValue.push(fieldChoices[index]);
        });
      }

      return chosenValue;
    }

    /*
     * Get a field's data value. If a field has a choiceIndex and a value,
     * merge the value into the resolved choice(s).
     */
    function getFieldValue(field) {
      var fieldValue = field.value
        , fieldChoices = card.choices[field.id]
        , dataValue = card.data[field.id]
        , dataSrc = null
        , chosenValue = null
        ;

      /*
       * Choose data from, in order of preference:
       * 1) card.data
       * 2) field.value
       */
      // != null is true for undefined as well (don't use !==)
      if (dataValue != null) {
        dataSrc = dataValue;
      } else if (fieldValue != null) {
        dataSrc = field;
      }

      if (dataSrc != null) {
        if (dataSrc.choiceIndex != null) {
          chosenValue = resolveChoice(dataSrc.choiceIndex, fieldChoices);

          if (dataSrc.value != null) {
            Object.assign(chosenValue, dataSrc.value);
          }
        } else {
          chosenValue = dataSrc.value;
        }
      }

      return chosenValue;
    }
    that.getFieldValue = getFieldValue;

    /*
     * Resolve a color scheme reference in a field's data value. Color scheme
     * references are of the form $<color_scheme_name>.<color_key>.
     */
    function resolveColor(colorSchemes, value) {
      var schemeName = null
        , schemeField = null
        , parts = null
        ;

      if (value.startsWith('$')) {
        parts = value.substring(1).split('.');
        schemeName = parts[0];
        schemeField = parts[1];

        value = colorSchemes[schemeName][schemeField];
      }

      return value;
    }

    /*
     * Build drawing data for field type 'color'
     */
    function buildColorData(field, data, colorSchemes) {
      var resolvedColor = resolveColor(colorSchemes, data.color);

      return {
        type: 'color',
        x: field.x,
        y: field.y,
        height: field.height,
        width: field.width,
        color: resolvedColor
      };
    }

    /*
     * Build drawing data for field type 'line'
     */
    function buildLineData(field, colorSchemes) {
      var resolvedColor = resolveColor(colorSchemes, field.color);

      return {
        type: 'line',
        color: resolvedColor,
        startX: field.startX,
        startY: field.startY,
        endX: field.endX,
        endY: field.endY,
        width: field.width
      };
    }

    /*
     * Build drawing data for field type 'text'
     */
    function buildTextData(field, data, colorSchemes) {
      var text = data == null ? '' : data.text;

      return buildTextDataHelper(
        field.x,
        field.y,
        field.font,
        field.color,
        field.prefix,
        field.wrapAt,
        field.textAlign,
        text,
        colorSchemes
      );
    }

    /*
     * Build drawing data for field type key-val-text.
     */
    function buildKeyValTextData(field, data, colorSchemes) {
      return [
        buildTextDataHelper(
          field.keyX,
          field.y,
          field.font,
          field.color,
          field.prefix,
          field.wrapAt,
          field.textAlign,
          data.key.text,
          colorSchemes
        ),
        buildTextDataHelper(
          field.valX,
          field.y,
          field.font,
          field.color,
          field.prefix,
          field.wrapAt,
          field.textAlign,
          data.val.text,
          colorSchemes
        )
      ];
    }

    /*
     * Build drawing data of type 'text'
     */
    function buildTextDataHelper(
      x,
      y,
      font,
      color,
      prefix,
      wrapAt,
      textAlign,
      text,
      colorSchemes
    ) {
      var resolvedColor = resolveColor(colorSchemes, color);

      return {
        type: 'text',
        font: font,
        color: resolvedColor,
        text: text,
        prefix: prefix,
        x: x,
        y: y,
        wrapAt: wrapAt,
        textAlign: textAlign
      };
    }

    /*
     * Build drawing data for field type 'image'
     */
    function buildImageData(field, data, colorSchemes) {
      var results = [];

      if (field.credit) {
        results.push(buildTextData(field.credit, data.credit, colorSchemes));
      }

      results.push(buildImageDataHelper(field, data));

      return results;
    }

    /*
     * Build drawing data of type image
     */
    function buildImageDataHelper(field, data) {
        var result = {
          type: 'image',
          x: field.x,
          y: field.y,
          height: field.height,
          width: field.width,
          panX: data.panX,
          panY: data.panY,
          rotate: data.rotate,
          flipVert: data.flipVert,
          flipHoriz: data.flipHoriz,
          zoomLevel: data.zoomLevel,
          url: data.url,
          id: field.id
        };

      return result;
    }

    /*
     * Build drawing data for field type 'multi-image'
     */
    function buildMultiImageData(field, datas, colorSchemes) {
      var results = []
        , specs
        ;

      if (datas.length) {
        specs = field.specs[datas.length - 1];

        for (var i = 0; i < specs.length; i++) {
          var spec = specs[i]
            , data = datas[i]
            ;

          results.push(buildImageDataHelper(spec, data));
        }
      }

      return results;
    }

    /*
     * Build drawing data for field type key-val-list
     */
    function buildKeyValListData(field, data, colorSchemes) {
      var curData = null
        , offsetField = null
        , yOffset = 0
        , results = []
        ;

      for (var i = 0; i < data.length; i++) {
        // Build data for key-val element, setting the y value according
        // to the field's yIncr and y values
        curData = data[i];

        yOffset = i * field.yIncr + field.y;
        offsetField = Object.assign({}, field.keyValSpec);
        offsetField.y += yOffset;

        results = results.concat(
          buildKeyValTextData(offsetField, curData, colorSchemes)
        );

        // additionalElements (which do not require data)
        field.additionalElements.forEach(function(elemField) {
          switch(elemField.type) {
            case 'line':
              offsetField = Object.assign({}, elemField);
              offsetField.startY += yOffset;
              offsetField.endY += yOffset;
              results.push(buildLineData(offsetField, colorSchemes));
              break;
            default:
              throw new Error('Unsupported field type: ' + elemField.type);
          }
        });
      }

      return results;
    }

    /*
     * Build drawing data for a field
     */
    function buildDataForField(field, data, colorSchemes) {
      var results;

      switch (field.type) {
        case 'color':
          results = [buildColorData(field, data, colorSchemes)];
          break;
        case 'line':
          results = [buildLineData(field, colorSchemes)];
          break;
        case 'text':
          results = [buildTextData(field, data, colorSchemes)];
          break;
        case 'key-val-text':
          results = buildKeyValTextData(field, data, colorSchemes);
          break;
        case 'image':
        case 'labeled-choice-image':
          results = buildImageData(field, data, colorSchemes);
          break;
        case 'multi-image':
          results = buildMultiImageData(field, data, colorSchemes);
          break;
        case 'key-val-list':
          results = buildKeyValListData(field, data, colorSchemes);
          break;
        default:
          throw new Error('Invalid field type: ' + field.type);
      }

      return results;
    }

    function buildColorSchemes(colorSchemeFields) {
      var colorSchemes = {};

      colorSchemeFields.forEach(function(field) {
        var colorScheme = getFieldValue(field);
        colorSchemes[field.id] = colorScheme;
      });

      return colorSchemes;
    }

    /*
     * Build a list of primitive drawing data elements (of the types recognized
     * by the renderer) from the card.
     */
    function buildDrawingData() {
      var colorSchemeFields = []
        , otherFields = []
        , colorSchemes = null
        , drawingData = []
        ;

      fields().forEach(function(field) {
        if (field.type === 'color-scheme') {
          colorSchemeFields.push(field);
        } else {
          otherFields.push(field);
        }
      });

      colorSchemes = buildColorSchemes(colorSchemeFields);

      otherFields.forEach(function(field) {
        var chosenValue = getFieldValue(field)
          , fieldDatas = buildDataForField(field, chosenValue, colorSchemes)

        drawingData = drawingData.concat(fieldDatas);
      });

      return drawingData;
    }
    that.buildDrawingData = buildDrawingData;
  }

  return exports;
})();


if (typeof module !== 'undefined') {
  module.exports = exports;
} else {
  window.CardWrapper = exports;
}
