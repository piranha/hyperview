// @flow

/**
 * Copyright (c) Garuda Labs, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import * as Render from 'hyperview/src/services/render';
import {
  ATTRIBUTES,
  NAV_ACTIONS,
  PRESS_TRIGGERS_PROP_NAMES,
  UPDATE_ACTIONS,
} from './types';
import type {
  Element,
  HvComponentOnUpdate,
  PressTrigger,
} from 'hyperview/src/types';
import { PRESS_TRIGGERS, TRIGGERS } from 'hyperview/src/types';
import type { PressHandlers, Props, State } from './types';
import React, { PureComponent } from 'react';
import { RefreshControl, ScrollView, TouchableOpacity } from 'react-native';
import VisibilityDetectingView from 'hyperview/src/VisibilityDetectingView';
import { getBehaviorElements } from 'hyperview/src/services';

/**
 * Component that handles dispatching behaviors based on the appropriate
 * triggers.
 */
export default class HyperRef extends PureComponent<Props, State> {
  props: Props;
  state: State = {
    refreshing: false,
    pressed: false,
  };

  componentDidMount() {
    this.triggerLoadBehaviors();
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.element === this.props.element) {
      return;
    }
    this.triggerLoadBehaviors();
  }

  createActionHandler = (
    element: Element,
    behaviorElement: Element,
    onUpdate: HvComponentOnUpdate,
  ) => {
    const action =
      behaviorElement.getAttribute(ATTRIBUTES.ACTION) || NAV_ACTIONS.PUSH;

    if (Object.values(NAV_ACTIONS).indexOf(action) >= 0) {
      return () => {
        const href = behaviorElement.getAttribute(ATTRIBUTES.HREF);
        const showIndicatorId = behaviorElement.getAttribute(
          ATTRIBUTES.SHOW_DURING_LOAD,
        );
        const delay = behaviorElement.getAttribute(ATTRIBUTES.DELAY);
        onUpdate(href, action, element, { showIndicatorId, delay });
      };
    } else if (Object.values(UPDATE_ACTIONS).indexOf(action) >= 0) {
      return () => {
        const href = behaviorElement.getAttribute(ATTRIBUTES.HREF);
        const verb = behaviorElement.getAttribute(ATTRIBUTES.VERB);
        const targetId = behaviorElement.getAttribute(ATTRIBUTES.TARGET);
        const showIndicatorIds = behaviorElement.getAttribute(
          ATTRIBUTES.SHOW_DURING_LOAD,
        );
        const hideIndicatorIds = behaviorElement.getAttribute(
          ATTRIBUTES.HIDE_DURING_LOAD,
        );
        const delay = behaviorElement.getAttribute(ATTRIBUTES.DELAY);
        const once = behaviorElement.getAttribute(ATTRIBUTES.ONCE);
        onUpdate(href, action, element, {
          verb,
          targetId,
          showIndicatorIds,
          hideIndicatorIds,
          delay,
          once,
        });
      };
    }
    //
    // Custom behavior
    return () =>
      onUpdate(null, action, element, { custom: true, behaviorElement });
  };

  triggerLoadBehaviors = () => {
    const behaviorElements = getBehaviorElements(this.props.element);
    const loadBehaviors = behaviorElements.filter(
      e => e.getAttribute(ATTRIBUTES.TRIGGER) === TRIGGERS.LOAD,
    );

    loadBehaviors.forEach(behaviorElement => {
      const handler = this.createActionHandler(
        this.props.element,
        behaviorElement,
        this.props.onUpdate,
      );
      setTimeout(handler, 0);
    });
  };

  render() {
    const { refreshing, pressed } = this.state;
    const { element, stylesheets, onUpdate, options } = this.props;
    const behaviorElements = getBehaviorElements(element);
    const pressBehaviors = behaviorElements.filter(
      e =>
        PRESS_TRIGGERS.indexOf(
          e.getAttribute(ATTRIBUTES.TRIGGER) || TRIGGERS.PRESS,
        ) >= 0,
    );
    const visibleBehaviors = behaviorElements.filter(
      e => e.getAttribute(ATTRIBUTES.TRIGGER) === TRIGGERS.VISIBLE,
    );
    const refreshBehaviors = behaviorElements.filter(
      e => e.getAttribute(ATTRIBUTES.TRIGGER) === TRIGGERS.REFRESH,
    );

    // Render the component based on the XML element. Depending on the applied behaviors,
    // this component will be wrapped with others to provide the necessary interaction.
    let renderedComponent = Render.renderElement(
      element,
      stylesheets,
      onUpdate,
      { ...options, pressed, skipHref: true },
    );

    const styleAttr = element.getAttribute(ATTRIBUTES.HREF_STYLE);
    const hrefStyle = styleAttr
      ? styleAttr.split(' ').map(s => stylesheets.regular[s])
      : null;

    const pressHandlers: PressHandlers = {};

    // Render pressable element
    if (pressBehaviors.length > 0) {
      const props = {
        // Component will use touchable opacity to trigger href.
        activeOpacity: 1,
        style: hrefStyle,
      };

      // With multiple behaviors for the same trigger, we need to stagger
      // the updates a bit so that each update operates on the latest DOM.
      // Ideally, we could apply multiple DOM updates at a time.
      let time = 0;

      pressBehaviors.forEach(behaviorElement => {
        const trigger: PressTrigger =
          behaviorElement.getAttribute(ATTRIBUTES.TRIGGER) || TRIGGERS.PRESS;
        const triggerPropName = PRESS_TRIGGERS_PROP_NAMES[trigger];
        const handler = this.createActionHandler(
          element,
          behaviorElement,
          onUpdate,
        );
        if (pressHandlers[triggerPropName]) {
          const oldHandler = pressHandlers[triggerPropName];
          pressHandlers[triggerPropName] = () => {
            oldHandler();
            setTimeout(handler, time);
            time += 1;
          };
        } else {
          pressHandlers[triggerPropName] = handler;
        }
      });

      if (pressHandlers.onPressIn) {
        const oldHandler = pressHandlers.onPressIn;
        pressHandlers.onPressIn = () => {
          this.setState({ pressed: true });
          oldHandler();
        };
      } else {
        pressHandlers.onPressIn = () => {
          this.setState({ pressed: true });
        };
      }

      if (pressHandlers.onPressOut) {
        const oldHandler = pressHandlers.onPressOut;
        pressHandlers.onPressOut = () => {
          this.setState({ pressed: false });
          oldHandler();
        };
      } else {
        pressHandlers.onPressOut = () => {
          this.setState({ pressed: false });
        };
      }

      // Fix a conflict between onPressOut and onPress triggering at the same time.
      if (pressHandlers.onPressOut && pressHandlers.onPress) {
        const onPressHandler = pressHandlers.onPress;
        pressHandlers.onPress = () => {
          setTimeout(onPressHandler, time);
        };
      }

      renderedComponent = React.createElement(
        TouchableOpacity,
        { ...props, ...pressHandlers },
        renderedComponent,
      );
    }

    // Wrap component in a scrollview with a refresh control to trigger
    // the refresh behaviors.
    if (refreshBehaviors.length > 0) {
      const refreshHandlers = refreshBehaviors.map(behaviorElement =>
        this.createActionHandler(element, behaviorElement, onUpdate),
      );
      const onRefresh = () => refreshHandlers.forEach(h => h());

      const refreshControl = React.createElement(RefreshControl, {
        refreshing,
        onRefresh,
      });
      renderedComponent = React.createElement(
        ScrollView,
        { refreshControl, style: hrefStyle },
        renderedComponent,
      );
    }

    // Wrap component in a VisibilityDetectingView to trigger visibility behaviors.
    if (visibleBehaviors.length > 0) {
      const visibleHandlers = visibleBehaviors.map(behaviorElement =>
        this.createActionHandler(element, behaviorElement, onUpdate),
      );
      const onVisible = () => visibleHandlers.forEach(h => h());

      renderedComponent = React.createElement(
        VisibilityDetectingView,
        { onVisible, style: hrefStyle },
        renderedComponent,
      );
    }

    return renderedComponent;
  }
}
